fn main() {
    // Файл появляется в prepare-desktop. Пустая заглушка нужна только чтобы cargo check
    // на машине без Windows-сборки не падал: prepare её заменяет настоящим .node.
    let placeholder = std::path::Path::new("binaries/keyring.win32-x64-msvc.node");
    if !placeholder.exists() {
        let _ = std::fs::create_dir_all("binaries");
        let _ = std::fs::write(placeholder, []);
    }
    tauri_build::build()
}
