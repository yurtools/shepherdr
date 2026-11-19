//! The native application's GPUI transport. Document URL authorization, redirects,
//! body limits, timeout and view ownership remain in gpui-shell's image loader.
pub fn client() -> std::sync::Arc<dyn gpui::http_client::HttpClient> {
    std::sync::Arc::new(reqwest_client::ReqwestClient::new())
}
