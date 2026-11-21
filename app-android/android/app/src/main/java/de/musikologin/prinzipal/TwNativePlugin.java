package de.musikologin.prinzipal;

import android.accounts.Account;
import android.app.PendingIntent;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialException;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * Native Helfer für Prinzipal (aus dem Journal übernommen):
 *  signIn     – Google-Konto für die Firebase-Anmeldung (Credential Manager)
 *  authorize  – Zugang zu Kalender und Drive; nach der ersten Zustimmung still, ohne Rückfrage
 *  saveFile   – Datei in „Downloads“ speichern
 */
@CapacitorPlugin(name = "TwNative")
public class TwNativePlugin extends Plugin {
    static final String WEB_CLIENT_ID = "516159234064-8j1n4v9i3t8i5ouhioqqk55bb4ivfien.apps.googleusercontent.com";
    private final Executor executor = Executors.newSingleThreadExecutor();
    private ActivityResultLauncher<IntentSenderRequest> authLauncher;
    private PluginCall pendingAuth;

    @Override
    public void load() {
        authLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            result -> {
                PluginCall call = pendingAuth;
                pendingAuth = null;
                if (call == null) return;
                try {
                    AuthorizationResult ar = Identity.getAuthorizationClient(getActivity())
                        .getAuthorizationResultFromIntent(result.getData());
                    resolveToken(call, ar);
                } catch (ApiException e) {
                    call.reject("Google-Zugriff nicht erteilt", "CANCELED");
                }
            });
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        boolean silent = Boolean.TRUE.equals(call.getBoolean("silent", false));
        GetGoogleIdOption option = new GetGoogleIdOption.Builder()
            .setServerClientId(WEB_CLIENT_ID)
            .setFilterByAuthorizedAccounts(silent)
            .setAutoSelectEnabled(true)
            .build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager.create(getContext()).getCredentialAsync(getActivity(), request, null, executor,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential c = response.getCredential();
                    if (c instanceof CustomCredential && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                        GoogleIdTokenCredential g = GoogleIdTokenCredential.createFrom(c.getData());
                        JSObject o = new JSObject();
                        o.put("idToken", g.getIdToken());
                        o.put("email", g.getId());
                        o.put("name", g.getDisplayName());
                        call.resolve(o);
                    } else {
                        call.reject("Unerwartete Anmeldeart", "UNEXPECTED");
                    }
                }
                @Override
                public void onError(GetCredentialException e) {
                    call.reject(String.valueOf(e.getMessage()), e.getClass().getSimpleName());
                }
            });
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        CredentialManager.create(getContext()).clearCredentialStateAsync(new ClearCredentialStateRequest(), null, executor,
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override public void onResult(Void v) { call.resolve(); }
                @Override public void onError(ClearCredentialException e) { call.resolve(); }
            });
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        boolean silent = Boolean.TRUE.equals(call.getBoolean("silent", false));
        JSArray arr = call.getArray("scopes", new JSArray());
        List<Scope> scopes = new ArrayList<>();
        try { for (int i = 0; i < arr.length(); i++) scopes.add(new Scope(arr.getString(i))); } catch (Exception e) { call.reject("Ungültige Bereiche"); return; }
        AuthorizationRequest.Builder b = AuthorizationRequest.builder().setRequestedScopes(scopes);
        String email = call.getString("email");
        if (email != null && !email.isEmpty()) b.setAccount(new Account(email, "com.google"));
        Identity.getAuthorizationClient(getActivity()).authorize(b.build())
            .addOnSuccessListener(ar -> {
                if (ar.hasResolution()) {
                    if (silent) { call.reject("Zustimmung nötig", "NEEDS_CONSENT"); return; }
                    PendingIntent pi = ar.getPendingIntent();
                    if (pi == null) { call.reject("Keine Zustimmungsseite", "NO_INTENT"); return; }
                    pendingAuth = call;
                    getActivity().runOnUiThread(() -> authLauncher.launch(new IntentSenderRequest.Builder(pi.getIntentSender()).build()));
                } else {
                    resolveToken(call, ar);
                }
            })
            .addOnFailureListener(e -> call.reject(String.valueOf(e.getMessage()), "FAILED"));
    }

    private void resolveToken(PluginCall call, AuthorizationResult ar) {
        String t = ar.getAccessToken();
        if (t == null) { call.reject("Kein Zugang erhalten", "NO_TOKEN"); return; }
        JSObject o = new JSObject();
        o.put("accessToken", t);
        o.put("scopes", new JSArray(ar.getGrantedScopes()));
        call.resolve(o);
    }

    /** Womit wurde die App geöffnet (Knopf im Widget)? */
    @PluginMethod
    public void launchInfo(PluginCall call) {
        JSObject o = new JSObject();
        android.app.Activity a = getActivity();
        android.content.Intent i = a != null ? a.getIntent() : null;
        String p = i != null ? i.getStringExtra("pz") : null;
        if (p != null) { o.put("pz", p); i.removeExtra("pz"); }
        call.resolve(o);
    }

    /** Die App legt hier ab, was das Widget zeigen soll (Termine, Geburtstage, Arbeitszeit). */
    @PluginMethod
    public void setWidget(PluginCall call) {
        String json = call.getString("json", "{}");
        getContext().getSharedPreferences("pz", android.content.Context.MODE_PRIVATE).edit().putString("data", json).putLong("at", System.currentTimeMillis()).apply();
        PzWidget.updateAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("filename", "Datei");
        String mime = call.getString("mimeType", "application/octet-stream");
        String data = call.getString("base64", "");
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("Speichern nicht möglich");
                try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) { os.write(bytes); }
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                dir.mkdirs();
                try (FileOutputStream fos = new FileOutputStream(new File(dir, name))) { fos.write(bytes); }
            }
            JSObject o = new JSObject(); o.put("ok", true); call.resolve(o);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "SAVE_FAILED");
        }
    }
}
