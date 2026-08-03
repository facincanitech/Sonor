package com.facincanitech.sonorhub;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

// Lê as fotos mais recentes da galeria (MediaStore) pra "Salvar fotos na
// nuvem" comparar com o que já subiu pro Drive e enviar só as novas — sem
// precisar abrir o seletor manual toda vez. Só funciona com o app aberto/em
// primeiro plano (não é um serviço de segundo plano de verdade — isso
// precisaria de WorkManager + testes num dispositivo real, fora do alcance
// de uma sessão sem build/emulador à mão).
@CapacitorPlugin(
    name = "PhotoSync",
    permissions = {
        @Permission(strings = { android.Manifest.permission.READ_MEDIA_IMAGES }, alias = "photos33"),
        @Permission(strings = { android.Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "photosLegacy"),
    }
)
public class PhotoSyncPlugin extends Plugin {

    private String permissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "photos33" : "photosLegacy";
    }

    @PluginMethod
    public void getRecentPhotos(PluginCall call) {
        String alias = permissionAlias();
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "photosPermsCallback");
            return;
        }
        readRecentPhotos(call);
    }

    @PermissionCallback
    private void photosPermsCallback(PluginCall call) {
        if (getPermissionState(permissionAlias()) == PermissionState.GRANTED) {
            readRecentPhotos(call);
        } else {
            call.reject("Permissão de acesso às fotos negada.");
        }
    }

    private void readRecentPhotos(PluginCall call) {
        int limit = call.getInt("limit", 10);
        ContentResolver resolver = getContext().getContentResolver();
        Uri collection = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        String[] projection = { MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.MIME_TYPE };
        String sortOrder = MediaStore.Images.Media.DATE_ADDED + " DESC LIMIT " + limit;

        JSArray photos = new JSArray();
        try (Cursor cursor = resolver.query(collection, projection, null, null, sortOrder)) {
            if (cursor == null) {
                call.resolve(new JSObject().put("photos", photos));
                return;
            }
            int idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
            int nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME);
            int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE);
            while (cursor.moveToNext()) {
                long id = cursor.getLong(idCol);
                String name = cursor.getString(nameCol);
                String mime = cursor.getString(mimeCol);
                Uri photoUri = Uri.withAppendedPath(collection, String.valueOf(id));
                String base64 = readAsBase64(resolver, photoUri);
                if (base64 == null) continue; // pula se não conseguir ler esse arquivo específico
                JSObject photo = new JSObject();
                photo.put("id", String.valueOf(id));
                photo.put("name", name != null ? name : ("foto_" + id + ".jpg"));
                photo.put("mimeType", mime != null ? mime : "image/jpeg");
                photo.put("base64", base64);
                photos.put(photo);
            }
            call.resolve(new JSObject().put("photos", photos));
        } catch (Exception e) {
            call.reject("Erro ao ler fotos: " + e.getMessage());
        }
    }

    private String readAsBase64(ContentResolver resolver, Uri uri) {
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }
}
