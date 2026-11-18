package com.tsing.deepseekforchat;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * In-app APK download and install. Implemented in Java on purpose: the app module has zero
 * Kotlin anywhere, and adding Kotlin would be a toolchain change for no capability gain.
 * Registered manually in MainActivity (registerPlugin); cap sync cannot wipe that.
 * Downloads go to getCacheDir(), which the existing FileProvider cache-path already exposes.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private static final String APK_FILE_NAME = "chat-demo-update.apk";
    private static final int MAX_REDIRECTS = 5;
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final int BUFFER_SIZE = 8192;
    private static final long PROGRESS_THROTTLE_MS = 150;

    @PluginMethod
    public void downloadApk(PluginCall call) {
        String url = call.getString("url");
        String expectedSha256 = call.getString("expectedSha256");
        if (url == null || url.isEmpty()) {
            call.reject("MISSING_URL");
            return;
        }
        new Thread(() -> downloadInBackground(call, url, expectedSha256)).start();
    }

    private void downloadInBackground(PluginCall call, String urlString, String expectedSha256) {
        File target = new File(getContext().getCacheDir(), APK_FILE_NAME);
        HttpURLConnection connection = null;
        try {
            connection = openConnectionFollowingRedirects(urlString);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                call.reject("HTTP_" + status);
                return;
            }
            long total = connection.getContentLengthLong();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long downloaded = 0;
            long lastEvent = 0;
            try (InputStream in = connection.getInputStream();
                    FileOutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    digest.update(buffer, 0, read);
                    out.write(buffer, 0, read);
                    downloaded += read;
                    long now = System.currentTimeMillis();
                    if (now - lastEvent >= PROGRESS_THROTTLE_MS) {
                        lastEvent = now;
                        notifyDownloadProgress(downloaded, total);
                    }
                }
            }
            notifyDownloadProgress(downloaded, total);
            if (total > 0 && downloaded != total) {
                target.delete();
                call.reject("SIZE_MISMATCH");
                return;
            }
            String sha256 = toHex(digest.digest());
            if (expectedSha256 != null
                    && !expectedSha256.isEmpty()
                    && !sha256.equalsIgnoreCase(expectedSha256)) {
                target.delete();
                call.reject("SHA256_MISMATCH");
                return;
            }
            JSObject result = new JSObject();
            result.put("path", target.getAbsolutePath());
            result.put("bytes", downloaded);
            result.put("sha256", sha256);
            call.resolve(result);
        } catch (Exception e) {
            target.delete();
            call.reject("DOWNLOAD_FAILED", e);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /**
     * Follows redirects manually: GitHub asset URLs redirect to a storage host, and the
     * redirect must be followed even across hosts. GET only, so re-issuing is safe.
     */
    private HttpURLConnection openConnectionFollowingRedirects(String urlString)
            throws IOException {
        String current = urlString;
        for (int i = 0; i <= MAX_REDIRECTS; i++) {
            HttpURLConnection connection =
                    (HttpURLConnection) new URL(current).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("User-Agent", "deepseek-for-chat-updater");
            connection.setRequestProperty(
                    "Accept", "application/vnd.android.package-archive, application/octet-stream");
            int status = connection.getResponseCode();
            if (status == HttpURLConnection.HTTP_MOVED_PERM
                    || status == HttpURLConnection.HTTP_MOVED_TEMP
                    || status == HttpURLConnection.HTTP_SEE_OTHER
                    || status == 307
                    || status == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new IOException("Redirect without Location");
                }
                current = new URL(new URL(current), location).toString();
                continue;
            }
            return connection;
        }
        throw new IOException("Too many redirects");
    }

    private void notifyDownloadProgress(long downloaded, long total) {
        JSObject data = new JSObject();
        data.put("downloadedBytes", downloaded);
        data.put("totalBytes", total);
        notifyListeners("downloadProgress", data);
    }

    private static String toHex(byte[] bytes) {
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            hex.append(Character.forDigit((b >> 4) & 0xF, 16));
            hex.append(Character.forDigit(b & 0xF, 16));
        }
        return hex.toString();
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean canInstall = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            canInstall = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject result = new JSObject();
        result.put("canInstall", canInstall);
        call.resolve(result);
    }

    @PluginMethod
    public void openUnknownSourcesSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Intent intent =
                        new Intent(
                                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception e) {
                // No activity handles the intent (heavily customized ROM):
                // reject so the web side shows manual guidance.
                call.reject("SETTINGS_OPEN_FAILED", e);
                return;
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("MISSING_PATH");
            return;
        }
        try {
            File cacheDir = getContext().getCacheDir().getCanonicalFile();
            File file = new File(path).getCanonicalFile();
            if (!file.getPath().startsWith(cacheDir.getPath() + File.separator)
                    || !file.isFile()) {
                call.reject("INVALID_PATH");
                return;
            }
            Uri uri =
                    FileProvider.getUriForFile(
                            getContext(),
                            getContext().getPackageName() + ".fileprovider",
                            file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("INSTALL_FAILED", e);
        }
    }
}
