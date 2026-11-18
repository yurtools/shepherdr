//! Actual vendored adapter and policy loader; fake HTTP only; no OS window.
use anyhow::Result;
use gpui::{
    http_client::{AsyncBody, FakeHttpClient, Method, RedirectPolicy, Response},
    prelude::*,
    *,
};
use gpui_wgpu::CosmicTextSystem;
use std::{
    borrow::Cow,
    rc::Rc,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

mod capability;
mod document_images;
pub use capability::{Capabilities, HttpRequestGrant};

// The host's reqwest facade only contributes Url to these two modules. Use
// its identical url 2.5.8 type directly; HTTP transport remains GPUI's fake.
extern crate self as reqwest;
pub use url::Url;

// The unrelated filesystem capability methods must never run in image tests.
// Keep their opaque handle type compileable without linking a filesystem
// sandbox library; reaching this boundary is a test failure, never file I/O.
extern crate self as cap_std;
pub fn ambient_authority() {}
pub mod fs {
    #[derive(Debug)]
    pub struct Dir;
    impl Dir {
        pub fn open_ambient_dir(_: &std::path::Path, _: ()) -> std::io::Result<Self> {
            panic!("filesystem capability boundary must not be reached by image tests")
        }
    }
}

// Test-only immutable policy holder. The unchanged production Capabilities
// implementation makes all grant decisions. No JS interpreter or host modules
// are loaded. This is not a test of JS policy creation or mod initialization.
mod policy {
    use super::Capabilities;
    #[derive(Default)]
    pub struct Policy {
        capabilities: Capabilities,
    }
    impl Policy {
        pub fn new() -> Self {
            Self::default()
        }
        pub fn with_capabilities(mut self, capabilities: Capabilities) -> Self {
            self.capabilities = capabilities;
            self
        }
        pub fn capabilities(&self) -> &Capabilities {
            &self.capabilities
        }
    }
    pub fn update_default(_: impl FnOnce(Policy) -> Policy) {
        panic!("global policy changes are forbidden in this harness")
    }
}

struct Scene {
    source: String,
    policy: Rc<policy::Policy>,
    visible: bool,
    scrollable: bool,
}
impl Render for Scene {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .bg(rgb(0xffffff))
            .text_color(rgb(0x111111))
            .font_family("Geist")
            .text_size(px(20.))
            .when(self.visible, |this| {
                this.child(document_images::with_policy(
                    gpui_base::TextView::markdown("stable-preview", self.source.clone())
                        .scrollable(self.scrollable),
                    self.policy.clone(),
                ))
            })
    }
}

fn context(pixels: bool) -> HeadlessAppContext {
    let native = Arc::new(CosmicTextSystem::new("Geist"));
    native
        .add_fonts(vec![Cow::Owned(
            std::fs::read(std::env::var("HERDR_IMAGE_FONT").unwrap()).unwrap(),
        )])
        .unwrap();
    let mut cx = HeadlessAppContext::with_platform(native, Arc::new(()), move || {
        if pixels {
            Ok(Some(Box::new(gpui_wgpu::WgpuHeadlessRenderer::new()?)))
        } else {
            Ok(None)
        }
    });
    cx.update(gpui_base::init);
    cx
}

fn grant() -> Capabilities {
    Capabilities::new().http_requests([HttpRequestGrant::new(
        "images.example",
        ["GET"],
        [] as [&str; 0],
        ["/"],
    )])
}

fn png(color: [u8; 4]) -> Vec<u8> {
    let image = image::RgbaImage::from_pixel(48, 24, image::Rgba(color));
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

fn response(status: u16, bytes: Vec<u8>) -> Response<AsyncBody> {
    Response::builder()
        .status(status)
        .body(bytes.into())
        .unwrap()
}

fn draw(cx: &mut HeadlessAppContext, window: WindowHandle<Scene>) {
    for _ in 0..4 {
        cx.update_window(window.into(), |_, window, cx| {
            window.draw(cx).clear(cx);
        })
        .unwrap();
        cx.run_until_parked();
    }
}

fn open(
    cx: &mut HeadlessAppContext,
    source: &str,
    capabilities: Capabilities,
    scrollable: bool,
) -> WindowHandle<Scene> {
    let policy = Rc::new(policy::Policy::new().with_capabilities(capabilities));
    cx.open_window(size(px(640.), px(220.)), |_, cx| {
        cx.new(|_| Scene {
            source: source.into(),
            policy,
            visible: true,
            scrollable,
        })
    })
    .unwrap()
}

fn loaded(cx: &mut HeadlessAppContext, window: WindowHandle<Scene>) -> Vec<Arc<RenderImage>> {
    cx.update_window(window.into(), |_, window, _| window.displayed_images())
        .unwrap()
}

fn permitted_images_and_frames(pixels: bool, diagnose: bool) {
    let forms = [
        (
            "inline",
            "Before ![logo](https://images.example/a.png \"title\") after",
        ),
        (
            "full",
            "Before ![logo][pic] after\n\n[pic]: https://images.example/a.png \"title\"",
        ),
        (
            "collapsed",
            "Before ![logo][] after\n\n[logo]: https://images.example/a.png \"title\"",
        ),
        (
            "shortcut",
            "Before ![logo] after\n\n[logo]: https://images.example/a.png \"title\"",
        ),
    ];
    for scrollable in [false, true] {
        let mut frames = Vec::new();
        for (name, source) in forms {
            let mut cx = context(pixels);
            let calls = Arc::new(AtomicUsize::new(0));
            let record = calls.clone();
            cx.update(|cx| {
                cx.set_http_client(FakeHttpClient::create(move |request| {
                    assert_eq!(request.method(), Method::GET);
                    assert_eq!(
                        request.extensions().get::<RedirectPolicy>(),
                        Some(&RedirectPolicy::NoFollow)
                    );
                    record.fetch_add(1, Ordering::SeqCst);
                    async { Ok(response(200, png([28, 153, 97, 255]))) }
                }))
            });
            let window = open(&mut cx, source, grant(), scrollable);
            draw(&mut cx, window);
            let actual = loaded(&mut cx, window);
            if !diagnose {
                assert_eq!(
                    calls.load(Ordering::SeqCst),
                    1,
                    "{name}: permitted reference must reach existing policy loader"
                );
                assert_eq!(
                    actual.len(),
                    1,
                    "{name}: decoded image must be in current native scene"
                );
            }
            println!(
                "NATIVE {name} scrollable={scrollable}: requests={} scene_images={}",
                calls.load(Ordering::SeqCst),
                actual.len()
            );
            draw(&mut cx, window);
            if !diagnose {
                assert_eq!(
                    calls.load(Ordering::SeqCst),
                    1,
                    "repaint reuses the document cache"
                );
            }
            if pixels {
                let frame = window.render_current_to_image(&mut cx).unwrap();
                frame.save(format!("{name}-{scrollable}.png")).unwrap();
                frames.push(frame);
            }
        }
        if pixels && !diagnose {
            assert!(
                frames[1..].iter().all(|f| f == &frames[0]),
                "inline/full/collapsed/shortcut native pixels match"
            );
            println!(
                "PASS identical native WGPU frames for all four forms; scrollable={scrollable}"
            );
        }
    }
}

fn policy_failures_and_timeout() {
    for (url, allowed) in [
        ("https://images.example/a.png", true),
        ("http://images.example/a.png", false),
        ("https://other.example/a.png", false),
        ("https://images.example:8443/a.png", false),
        ("https://user:password@images.example/a.png", false),
        ("file:///tmp/a.png", false),
        ("data:image/png;base64,AAAA", false),
        ("/tmp/a.png", false),
        ("a.png", false),
        ("//images.example/a.png", false),
    ] {
        for granted in [false, true] {
            let mut cx = context(false);
            let calls = Arc::new(AtomicUsize::new(0));
            let record = calls.clone();
            cx.update(|cx| {
                cx.set_http_client(FakeHttpClient::create(move |_| {
                    record.fetch_add(1, Ordering::SeqCst);
                    async { Ok(response(200, png([28, 153, 97, 255]))) }
                }))
            });
            let source = format!("![logo][pic]\n\n[pic]: {url}");
            let window = open(
                &mut cx,
                &source,
                if granted {
                    grant()
                } else {
                    Capabilities::new()
                },
                false,
            );
            draw(&mut cx, window);
            assert_eq!(
                calls.load(Ordering::SeqCst),
                usize::from(allowed && granted),
                "{url}"
            );
            assert_eq!(
                loaded(&mut cx, window).len(),
                usize::from(allowed && granted),
                "{url}"
            );
        }
    }
    println!(
        "PASS reference images preserve HTTP(S), GET grants, scheme/host/port/userinfo restrictions"
    );
    for mode in [
        "404",
        "decode",
        "oversize",
        "redirect-denied",
        "redirect-loop",
        "timeout",
    ] {
        let mut cx = context(false);
        let calls = Arc::new(AtomicUsize::new(0));
        let record = calls.clone();
        cx.update(|cx| {
            cx.set_http_client(FakeHttpClient::create(move |request| {
                assert_eq!(
                    request.extensions().get::<RedirectPolicy>(),
                    Some(&RedirectPolicy::NoFollow)
                );
                record.fetch_add(1, Ordering::SeqCst);
                async move {
                    Ok(match mode {
                        "404" => response(404, Vec::new()),
                        "decode" => response(200, b"not an image".to_vec()),
                        "oversize" => response(200, vec![0; 8 * 1024 * 1024 + 1]),
                        "redirect-denied" => Response::builder()
                            .status(302)
                            .header("location", "https://other.example/a.png")
                            .body(().into())
                            .unwrap(),
                        "redirect-loop" => Response::builder()
                            .status(302)
                            .header("location", "/a.png")
                            .body(().into())
                            .unwrap(),
                        "timeout" => std::future::pending().await,
                        _ => unreachable!(),
                    })
                }
            }))
        });
        let window = open(
            &mut cx,
            "Before ![logo][pic] after\n\n[pic]: https://images.example/a.png",
            grant(),
            false,
        );
        draw(&mut cx, window);
        if mode == "timeout" {
            cx.advance_clock(Duration::from_secs(31));
            cx.run_until_parked();
            draw(&mut cx, window);
        }
        assert!(loaded(&mut cx, window).is_empty(), "{mode}");
        assert_eq!(
            calls.load(Ordering::SeqCst),
            if mode == "redirect-loop" { 11 } else { 1 },
            "{mode}"
        );
        draw(&mut cx, window);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            if mode == "redirect-loop" { 11 } else { 1 },
            "failed loads are cached"
        );
        println!("PASS {mode}: no image or retry/fallback");
    }
}

struct DropNotice(Arc<AtomicUsize>);
impl Drop for DropNotice {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

fn stale_loads_and_disposal() {
    for complete_old in [false, true] {
        let mut cx = context(false);
        let dropped = Arc::new(AtomicUsize::new(0));
        let guard = dropped.clone();
        let (tx, rx) = async_channel::bounded(1);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let record = calls.clone();
        cx.update(|cx| {
            cx.set_http_client(FakeHttpClient::create(move |request| {
                let old = request.uri().path() == "/old.png";
                record.lock().unwrap().push(request.uri().to_string());
                let rx = rx.clone();
                let guard = guard.clone();
                async move {
                    if old {
                        let _notice = DropNotice(guard);
                        rx.recv().await.unwrap();
                        Ok(response(200, png([230, 35, 35, 255])))
                    } else {
                        Ok(response(200, png([28, 153, 97, 255])))
                    }
                }
            }))
        });
        let window = open(
            &mut cx,
            "![logo][pic]\n\n[pic]: https://images.example/old.png",
            grant(),
            false,
        );
        draw(&mut cx, window);
        assert!(loaded(&mut cx, window).is_empty());
        window
            .update(&mut cx, |scene, _, cx| {
                scene.source = scene.source.replace("old.png", "new.png");
                cx.notify();
            })
            .unwrap();
        draw(&mut cx, window);
        let current = loaded(&mut cx, window);
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].as_bytes(0).unwrap()[..4], [97, 153, 28, 255]);
        if complete_old {
            tx.try_send(()).unwrap();
            cx.run_until_parked();
            draw(&mut cx, window);
            assert_eq!(
                loaded(&mut cx, window)[0].id,
                current[0].id,
                "stale completion must not replace current image"
            );
        }
        window
            .update(&mut cx, |scene, _, cx| {
                scene.visible = false;
                cx.notify();
            })
            .unwrap();
        draw(&mut cx, window);
        cx.run_until_parked();
        assert!(loaded(&mut cx, window).is_empty());
        assert_eq!(
            dropped.load(Ordering::SeqCst),
            1,
            "pending HTTP future must be dropped on disposal"
        );
        // Recreating the same view has a fresh owner and must fetch again.
        window
            .update(&mut cx, |scene, _, cx| {
                scene.visible = true;
                cx.notify();
            })
            .unwrap();
        draw(&mut cx, window);
        assert_eq!(
            calls.lock().unwrap().len(),
            3,
            "disposed view cannot reuse prior document assets"
        );
        println!(
            "PASS stale completion={complete_old}: current image preserved; release cancels pending work and evicts cache"
        );
    }
}

fn policies_cannot_borrow_successful_or_failed_assets() {
    let mut cx = context(false);
    let calls = Arc::new(AtomicUsize::new(0));
    let record = calls.clone();
    cx.update(|cx| {
        cx.set_http_client(FakeHttpClient::create(move |_| {
            record.fetch_add(1, Ordering::SeqCst);
            async { Ok(response(200, png([28, 153, 97, 255]))) }
        }))
    });
    let source = "![logo][pic]\n\n[pic]: https://images.example/a.png";
    let window = open(&mut cx, source, grant(), false);
    draw(&mut cx, window);
    assert_eq!(loaded(&mut cx, window).len(), 1);
    window
        .update(&mut cx, |scene, _, cx| {
            scene.policy = Rc::new(policy::Policy::new());
            cx.notify();
        })
        .unwrap();
    draw(&mut cx, window);
    assert!(
        loaded(&mut cx, window).is_empty(),
        "a denied policy cannot borrow an authorized image"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    window
        .update(&mut cx, |scene, _, cx| {
            scene.policy = Rc::new(policy::Policy::new().with_capabilities(grant()));
            cx.notify();
        })
        .unwrap();
    draw(&mut cx, window);
    assert_eq!(
        loaded(&mut cx, window).len(),
        1,
        "a denial must not poison another owner"
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        2,
        "a new policy gets a fresh owner and cache"
    );
    println!("PASS policy replacement separates successful and denied caches");
}

fn main() -> Result<()> {
    let pixels = std::env::args().any(|a| a == "--pixels");
    let diagnose = std::env::args().any(|a| a == "--diagnose");
    if !diagnose {
        gpui_base::text::verify_reference_images();
        gpui_base::text::verify_reference_image_state(&mut context(false));
        document_images::verify_original_policy(&mut context(false));
        policy_failures_and_timeout();
        stale_loads_and_disposal();
        policies_cannot_borrow_successful_or_failed_assets();
    }
    permitted_images_and_frames(pixels, diagnose);
    Ok(())
}
