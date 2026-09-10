//! A very small WebSocket client — just enough to talk to the sherpa-onnx
//! offline recognizer that `parakeet.rs` keeps resident on 127.0.0.1.
//!
//! Why not a crate: the whole conversation is one binary message out and one
//! text message back, over loopback, to a server this process started itself.
//! `tokio-tungstenite` would drag an async stack and a version negotiation into
//! a path that is 150 lines of RFC 6455 framing, and this way the recognizer
//! call stays an ordinary blocking function on a `spawn_blocking` thread.
//!
//! Deliberately not implemented, because the peer is our own child process on
//! loopback: TLS, permessage-deflate, and verifying `Sec-WebSocket-Accept`
//! (which exists to stop a *browser* from being tricked into speaking
//! WebSocket to a non-WebSocket server; we check for `101 Switching Protocols`
//! instead). Do not point this at a remote host.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use base64::Engine as _;
use rand::RngCore;

const OP_TEXT: u8 = 0x1;
const OP_BINARY: u8 = 0x2;
const OP_CLOSE: u8 = 0x8;
const OP_PING: u8 = 0x9;
const OP_PONG: u8 = 0xa;

/// A frame the peer sent us, already de-fragmented.
pub enum Message {
    Text(String),
    Binary(Vec<u8>),
    Close,
}

pub struct WebSocket {
    stream: TcpStream,
    reader: BufReader<TcpStream>,
}

impl WebSocket {
    /// Opens a connection and performs the HTTP upgrade. `timeout` bounds both
    /// the connect and every later read/write.
    pub fn connect(addr: SocketAddr, timeout: Duration) -> Result<Self, String> {
        let stream = TcpStream::connect_timeout(&addr, timeout)
            .map_err(|e| format!("connect to {addr}: {e}"))?;
        stream.set_nodelay(true).ok();
        stream.set_read_timeout(Some(timeout)).ok();
        stream.set_write_timeout(Some(timeout)).ok();

        let mut key = [0u8; 16];
        rand::rng().fill_bytes(&mut key);
        let key = base64::engine::general_purpose::STANDARD.encode(key);

        let request = format!(
            "GET / HTTP/1.1\r\nHost: {addr}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
             Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        );
        let mut write_half = stream.try_clone().map_err(|e| e.to_string())?;
        write_half
            .write_all(request.as_bytes())
            .map_err(|e| format!("handshake write: {e}"))?;

        let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
        let mut status = String::new();
        reader
            .read_line(&mut status)
            .map_err(|e| format!("handshake read: {e}"))?;
        if !status.contains("101") {
            return Err(format!("handshake refused: {}", status.trim()));
        }
        // Drain the response headers; we need none of them.
        loop {
            let mut line = String::new();
            let read = reader
                .read_line(&mut line)
                .map_err(|e| format!("handshake read: {e}"))?;
            if read == 0 || line == "\r\n" || line == "\n" {
                break;
            }
        }

        Ok(Self {
            stream: write_half,
            reader,
        })
    }

    fn send_frame(&mut self, opcode: u8, payload: &[u8]) -> Result<(), String> {
        let mut header: Vec<u8> = Vec::with_capacity(14);
        header.push(0x80 | opcode); // FIN + opcode
        let len = payload.len();
        // A client MUST mask, so the length byte always carries the mask bit.
        if len < 126 {
            header.push(0x80 | len as u8);
        } else if len <= u16::MAX as usize {
            header.push(0x80 | 126);
            header.extend_from_slice(&(len as u16).to_be_bytes());
        } else {
            header.push(0x80 | 127);
            header.extend_from_slice(&(len as u64).to_be_bytes());
        }
        let mut mask = [0u8; 4];
        rand::rng().fill_bytes(&mut mask);
        header.extend_from_slice(&mask);

        let mut framed = header;
        framed.reserve(len);
        for (i, byte) in payload.iter().enumerate() {
            framed.push(byte ^ mask[i & 3]);
        }
        self.stream
            .write_all(&framed)
            .map_err(|e| format!("send: {e}"))
    }

    pub fn send_binary(&mut self, payload: &[u8]) -> Result<(), String> {
        self.send_frame(OP_BINARY, payload)
    }

    pub fn send_text(&mut self, text: &str) -> Result<(), String> {
        self.send_frame(OP_TEXT, text.as_bytes())
    }

    /// Reads one *message*, joining continuation frames and answering pings.
    pub fn read_message(&mut self) -> Result<Message, String> {
        let mut buffer: Vec<u8> = Vec::new();
        let mut kind: Option<u8> = None;
        loop {
            let (fin, opcode, payload) = self.read_frame()?;
            match opcode {
                OP_CLOSE => return Ok(Message::Close),
                OP_PING => {
                    self.send_frame(OP_PONG, &payload)?;
                    continue;
                }
                OP_PONG => continue,
                0x0 => {
                    if kind.is_none() {
                        return Err("continuation frame without a start".into());
                    }
                    buffer.extend_from_slice(&payload);
                }
                OP_TEXT | OP_BINARY => {
                    kind = Some(opcode);
                    buffer = payload;
                }
                other => return Err(format!("unexpected opcode {other:#x}")),
            }
            if fin {
                return match kind {
                    Some(OP_TEXT) => String::from_utf8(buffer)
                        .map(Message::Text)
                        .map_err(|e| format!("text frame is not UTF-8: {e}")),
                    _ => Ok(Message::Binary(buffer)),
                };
            }
        }
    }

    fn read_frame(&mut self) -> Result<(bool, u8, Vec<u8>), String> {
        let mut head = [0u8; 2];
        self.reader
            .read_exact(&mut head)
            .map_err(|e| format!("read: {e}"))?;
        let fin = head[0] & 0x80 != 0;
        if head[0] & 0x70 != 0 {
            // We never negotiate an extension, so RSV bits must be clear.
            return Err("reserved bits set (unexpected extension)".into());
        }
        let opcode = head[0] & 0x0f;
        let masked = head[1] & 0x80 != 0;
        let mut len = (head[1] & 0x7f) as usize;
        if len == 126 {
            let mut ext = [0u8; 2];
            self.reader.read_exact(&mut ext).map_err(|e| e.to_string())?;
            len = u16::from_be_bytes(ext) as usize;
        } else if len == 127 {
            let mut ext = [0u8; 8];
            self.reader.read_exact(&mut ext).map_err(|e| e.to_string())?;
            let wide = u64::from_be_bytes(ext);
            // 64 MB is far more than a transcript; refuse to allocate wildly.
            if wide > 64 * 1024 * 1024 {
                return Err("frame too large".into());
            }
            len = wide as usize;
        }
        let mut mask = [0u8; 4];
        if masked {
            self.reader.read_exact(&mut mask).map_err(|e| e.to_string())?;
        }
        let mut payload = vec![0u8; len];
        self.reader
            .read_exact(&mut payload)
            .map_err(|e| format!("read payload: {e}"))?;
        if masked {
            for (i, byte) in payload.iter_mut().enumerate() {
                *byte ^= mask[i & 3];
            }
        }
        Ok((fin, opcode, payload))
    }

    /// Best-effort close; the caller is dropping the socket either way.
    pub fn close(&mut self) {
        let _ = self.send_frame(OP_CLOSE, &1000u16.to_be_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    /// The framing a client writes is what the RFC's masked-frame example
    /// describes: FIN + opcode, the mask bit on the length, four key bytes,
    /// then the payload XORed with the key.
    #[test]
    fn client_frames_are_masked() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let n = sock.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..n]).contains("Sec-WebSocket-Key:"));
            sock.write_all(
                b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\
                  Connection: Upgrade\r\n\r\n",
            )
            .unwrap();
            let mut frame = [0u8; 64];
            let n = sock.read(&mut frame).unwrap();
            let frame = &frame[..n];
            assert_eq!(frame[0], 0x82, "FIN + binary");
            assert_eq!(frame[1] & 0x80, 0x80, "client frames are masked");
            let len = (frame[1] & 0x7f) as usize;
            let mask = &frame[2..6];
            let unmasked: Vec<u8> = frame[6..6 + len]
                .iter()
                .enumerate()
                .map(|(i, b)| b ^ mask[i & 3])
                .collect();
            assert_eq!(unmasked, vec![1, 2, 3, 4, 5]);
            // Answer with an unmasked text frame, the way a server does.
            let body = b"{\"text\":\"hello\"}";
            let mut reply = vec![0x81, body.len() as u8];
            reply.extend_from_slice(body);
            sock.write_all(&reply).unwrap();
        });

        let mut ws = WebSocket::connect(addr, Duration::from_secs(5)).unwrap();
        ws.send_binary(&[1, 2, 3, 4, 5]).unwrap();
        match ws.read_message().unwrap() {
            Message::Text(text) => assert_eq!(text, "{\"text\":\"hello\"}"),
            _ => panic!("expected a text message"),
        }
        server.join().unwrap();
    }

    #[test]
    fn continuation_frames_are_joined() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = sock.read(&mut request).unwrap();
            sock.write_all(b"HTTP/1.1 101 Switching Protocols\r\n\r\n").unwrap();
            // "hel" as a text frame without FIN, "lo" as a continuation.
            sock.write_all(&[0x01, 3, b'h', b'e', b'l']).unwrap();
            sock.write_all(&[0x80, 2, b'l', b'o']).unwrap();
        });
        let mut ws = WebSocket::connect(addr, Duration::from_secs(5)).unwrap();
        match ws.read_message().unwrap() {
            Message::Text(text) => assert_eq!(text, "hello"),
            _ => panic!("expected a text message"),
        }
        server.join().unwrap();
    }
}
