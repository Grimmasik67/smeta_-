package ru.markin.zatraty;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.JsPromptResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowInsets;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline application. The WebView may load only the app's bundled files. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START = ORIGIN + "/assets/index.html";
    private static final int IMPORT = 1, EXPORT = 2;
    private static final int MAX_EXPORT_BYTES = 20 * 1024 * 1024;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingExport;
    private boolean exporting;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(44, 62, 80));
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return insets;
            });
        }
        setContentView(root);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only a user-selected JSON document is read by the file input.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        web.addJavascriptInterface(new Files(), "NativeFiles");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()) && uri.getPath() != null && uri.getPath().startsWith("/assets/")) {
                    String name = uri.getPath().substring(8);
                    if (name.contains("..") || name.contains("\\") || name.startsWith("/")) return blocked();
                    try {
                        String type = name.endsWith(".html") ? "text/html" : name.endsWith(".js") ? "text/javascript" : name.endsWith(".png") ? "image/png" : "application/octet-stream";
                        return new WebResourceResponse(type, name.endsWith(".png") ? null : "UTF-8", getAssets().open(name));
                    } catch (Exception error) { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0])); }
                }
                return blocked();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (START.equals(uri.toString())) return false;
                if (request.isForMainFrame() && request.hasGesture() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception error) { toast("Не удалось открыть ссылку."); }
                }
                return true;
            }

        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                try { startActivityForResult(intent, IMPORT); } catch (Exception error) { fileCallback.onReceiveValue(null); fileCallback = null; toast("Не удалось открыть выбор файла."); }
                return true;
            }
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("ОК", (dialog, which) -> result.confirm()).setOnCancelListener(dialog -> result.cancel()).show(); return true;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("Да", (dialog, which) -> result.confirm()).setNegativeButton("Нет", (dialog, which) -> result.cancel()).setOnCancelListener(dialog -> result.cancel()).show(); return true;
            }
            @Override public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                EditText input = new EditText(MainActivity.this); input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setView(input).setPositiveButton("Добавить", (dialog, which) -> result.confirm(input.getText().toString())).setNegativeButton("Отмена", (dialog, which) -> result.cancel()).setOnCancelListener(dialog -> result.cancel()).show(); return true;
            }
        });
        // The start URL is fixed so installing an update retains the same storage origin.
        web.loadUrl(START);
    }
    private WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    private void exportFinished(boolean success) {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript("window.NativeExportFinished&&window.NativeExportFinished(" + success + ")", null); });
    }
    private void toast(String text) { runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show()); }
    public final class Files {
        @JavascriptInterface public void saveText(String content, String type, String filename) {
            if (content == null || content.length() > MAX_EXPORT_BYTES || content.getBytes(StandardCharsets.UTF_8).length > MAX_EXPORT_BYTES) { toast("Файл слишком большой для выгрузки."); exportFinished(false); return; }
            String mime = type != null && type.startsWith("text/csv") ? "text/csv" : "application/json";
            String name = filename == null ? "Затраты.json" : filename.replaceAll("[\\\\/\\p{Cntrl}]", "_");
            if (name.length() > 150) name = "Затраты" + (mime.equals("text/csv") ? ".csv" : ".json");
            final String exportName = name;
            runOnUiThread(() -> {
                if (exporting) { toast("Сначала заверши сохранение предыдущего файла."); return; }
                pendingExport = content; exporting = true;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, exportName);
                try { startActivityForResult(intent, EXPORT); } catch (Exception error) { exporting = false; pendingExport = null; exportFinished(false); toast("Не удалось открыть сохранение файла."); }
            });
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == IMPORT && fileCallback != null) {
            fileCallback.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null); fileCallback = null;
        } else if (request == EXPORT) {
            String text = pendingExport; pendingExport = null;
            if (result == RESULT_OK && data != null && data.getData() != null && text != null) {
                Uri uri = data.getData();
                io.execute(() -> {
                    try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) {
                        if (stream == null) throw new java.io.IOException();
                        stream.write(text.getBytes(StandardCharsets.UTF_8)); stream.flush();
                    } catch (Exception error) { exportFinished(false); toast("Не удалось сохранить файл. Повтори выгрузку."); runOnUiThread(() -> exporting = false); return; }
                    runOnUiThread(() -> exporting = false); exportFinished(true); toast("Файл сохранён.");
                });
            } else { exporting = false; exportFinished(false); toast("Сохранение файла отменено."); }
        }
    }
    @Override public void onBackPressed() {
        new AlertDialog.Builder(this).setMessage("Закрыть приложение? Изменения сохраняются автоматически. Для копии базы нажми «Выгрузить базу».")
            .setPositiveButton("Закрыть", (dialog, which) -> super.onBackPressed()).setNegativeButton("Остаться", null).show();
    }
    @Override protected void onPause() { if (web != null) web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (web != null) { web.removeJavascriptInterface("NativeFiles"); web.destroy(); }
        io.shutdown(); super.onDestroy();
    }
}
