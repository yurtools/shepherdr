//! Real loopback transport through the unchanged document image loader.
use super::*;
use std::{
    io::{Read as _, Write as _},
    net::TcpListener,
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    time::{Duration, Instant},
};

struct Endpoint {
    port: u16,
    requests: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Endpoint {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let thread = std::thread::spawn(move || {
            while !stopping.load(Ordering::SeqCst) {
                let (mut stream, _) = match listener.accept() {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(1));
                        continue;
                    }
                    Err(error) => panic!("loopback accept: {error}"),
                };
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") && request.len() < 16384 {
                    let mut byte = [0];
                    if stream.read(&mut byte).unwrap_or(0) == 0 { break; }
                    request.push(byte[0]);
                }
                let request = String::from_utf8(request).unwrap();
                let path = request.lines().next().unwrap().split_whitespace().nth(1).unwrap().to_string();
                assert!(request.starts_with("GET "));
                assert!(!request.to_ascii_lowercase().contains("authorization:"));
                assert!(!request.to_ascii_lowercase().contains("cookie:"));
                recorded.lock().unwrap().push(path.clone());
                let (status, headers, body) = match path.as_str() {
                    "/redirect-denied" => (302, "Location: /forbidden.png\r\n", Vec::new()),
                    "/redirect-allowed" => (302, "Location: /allowed.png\r\n", Vec::new()),
                    "/oversized" => (200, "", vec![0; MAX_IMAGE_BYTES as usize + 1]),
                    _ => (200, "Content-Type: image/png\r\n", crate::png([35, 126, 200, 255])),
                };
                let header = format!("HTTP/1.1 {status} Test\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                if stream.write_all(header.as_bytes()).is_ok() { let _ = stream.write_all(&body); }
            }
        });
        Self { port, requests, stop, thread: Some(thread) }
    }
    fn url(&self, path: &str) -> reqwest::Url {
        reqwest::Url::parse(&format!("http://127.0.0.1:{}{path}", self.port)).unwrap()
    }
    fn grants(&self, paths: &[&str]) -> Capabilities {
        Capabilities::new().http_requests([crate::HttpRequestGrant::new(
            "127.0.0.1", ["GET"], paths.iter().copied(), [] as [&str; 0],
        ).scheme("http").port(self.port)])
    }
}
impl Drop for Endpoint {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.thread.take().unwrap().join().unwrap();
    }
}

pub fn run_all(client: Arc<dyn HttpClient>) {
    let server = Endpoint::new();
    let granted = server.grants(&["/allowed.png", "/redirect-denied", "/redirect-allowed", "/oversized"]);
    let fetch = |path: &str| smol::block_on(request_image(client.clone(), granted.clone(), server.url(path)));

    let bytes = fetch("/allowed.png").expect("production GPUI client must perform a permitted image GET");
    assert_eq!(image::load_from_memory(&bytes).unwrap().width(), 48);
    println!("PASS production client performs permitted loopback GET and returns decodable PNG");

    let before = server.requests.lock().unwrap().clone();
    assert!(smol::block_on(request_image(client.clone(), Capabilities::new(), server.url("/forbidden.png"))).is_err());
    assert_eq!(*server.requests.lock().unwrap(), before, "denied initial URL must never reach the server");

    assert!(fetch("/redirect-denied").is_err());
    assert!(!server.requests.lock().unwrap().iter().any(|path| path == "/forbidden.png"),
        "NoFollow must prevent backend auto-follow before per-hop authorization");
    assert_eq!(fetch("/redirect-allowed").unwrap(), bytes);
    println!("PASS real redirect endpoints: permitted hop loads; denied target receives no request");

    let started = Instant::now();
    assert!(fetch("/oversized").unwrap_err().to_string().contains("8 MiB"));
    assert!(started.elapsed() < Duration::from_secs(10));
    println!("PASS production streamed body retains the unchanged 8 MiB loader bound");
}
