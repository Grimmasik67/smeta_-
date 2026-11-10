import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;
public final class SignApk {
    public static void main(String[] args) throws Exception {
        char[] password = System.getenv("ZATRATY_SIGN_PASSWORD").toCharArray();
        KeyStore store = KeyStore.getInstance("PKCS12");
        try(FileInputStream input = new FileInputStream(args[0])) { store.load(input, password); }
        PrivateKey key = (PrivateKey)store.getKey("zatraty", password);
        X509Certificate certificate = (X509Certificate)store.getCertificate("zatraty");
        ApkSigner.SignerConfig config = new ApkSigner.SignerConfig.Builder("zatraty", key, Collections.singletonList(certificate)).build();
        new ApkSigner.Builder(Collections.singletonList(config)).setInputApk(new File(args[1])).setOutputApk(new File(args[2]))
            .setMinSdkVersion(26).setV1SigningEnabled(true).setV2SigningEnabled(true).setV3SigningEnabled(true).setV4SigningEnabled(false).build().sign();
        ApkVerifier.Result verification = new ApkVerifier.Builder(new File(args[2])).build().verify();
        if(!verification.isVerified()) throw new IllegalStateException("APK signature verification failed: " + verification.getErrors());
        System.out.println("APK signature verified: v1=" + verification.isVerifiedUsingV1Scheme() + ", v2=" + verification.isVerifiedUsingV2Scheme() + ", v3=" + verification.isVerifiedUsingV3Scheme());
        System.out.println("Package signed using the local release key.");
    }
}
