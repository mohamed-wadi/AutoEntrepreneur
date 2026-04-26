import { useEffect, useState } from "react";
import { Redirect } from "wouter";
import { Layout } from "@/components/layout";
import { API_BASE } from "@/lib/api-base";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SecurityPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const [driveLink, setDriveLink] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("driveFolderUrl") ?? "";
  });
  const [enabled, setEnabled] = useState<boolean>(false);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [disableOtp, setDisableOtp] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [disabledByServer, setDisabledByServer] = useState(false);

  const fetchStatus = async () => {
    const res = await fetch(`${API_BASE}/api/auth/2fa/status`, {
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error("Impossible de lire le statut 2FA");
    }
    const data = await res.json();
    setEnabled(Boolean(data.enabled));
    setDisabledByServer(Boolean(data.disabledByServer));
  };

  useEffect(() => {
    if (!user) return;
    fetchStatus().catch((e) =>
      toast({
        variant: "destructive",
        title: "Erreur",
        description: e instanceof Error ? e.message : "Erreur 2FA",
      }),
    );
  }, [user]);

  if (isAuthLoading) return null;
  if (!user) return <Redirect to="/" />;

  const startSetup = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/2fa/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Échec initialisation 2FA");
      setQrDataUrl(data.qrDataUrl);
      setManualKey(data.manualKey);
      toast({ title: "QR généré", description: "Scanne le QR dans Authenticator puis confirme avec le code OTP." });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Erreur 2FA",
        description: e instanceof Error ? e.message : "Erreur inconnue",
      });
    } finally {
      setLoading(false);
    }
  };

  const enable = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/2fa/enable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ otp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Échec activation 2FA");
      setEnabled(true);
      setQrDataUrl(null);
      setManualKey(null);
      setOtp("");
      setPassword("");
      toast({ title: "2FA activée", description: "La connexion demandera désormais un code OTP." });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Erreur 2FA",
        description: e instanceof Error ? e.message : "Erreur inconnue",
      });
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/2fa/disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: disablePassword, otp: disableOtp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Échec désactivation 2FA");
      setEnabled(false);
      setDisableOtp("");
      setDisablePassword("");
      setQrDataUrl(null);
      setManualKey(null);
      await fetchStatus();
      toast({ title: "2FA désactivée" });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Erreur 2FA",
        description: e instanceof Error ? e.message : "Erreur inconnue",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sécurité</h1>
          <p className="text-slate-500 mt-1">Active l'authentification à deux facteurs (OTP) via Google Authenticator.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Google Drive</CardTitle>
            <CardDescription>Lien du dossier Drive (bouton “Drive” dans le menu).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="drive-link">Lien Drive</Label>
              <Input
                id="drive-link"
                value={driveLink}
                onChange={(e) => setDriveLink(e.target.value)}
                placeholder="Ex: https://drive.google.com/drive/folders/..."
              />
              <p className="text-xs text-slate-500">
                Astuce: colle ici ton dossier “2026”. Exemple:{" "}
                <code className="rounded bg-muted px-1">https://drive.google.com/drive/folders/…</code>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem("driveFolderUrl", driveLink.trim());
                  }
                  toast({ title: "Lien Drive enregistré" });
                }}
                disabled={!driveLink.trim()}
              >
                Enregistrer
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const u = driveLink.trim();
                  if (!u) return;
                  window.open(u, "_blank", "noopener,noreferrer");
                }}
                disabled={!driveLink.trim()}
              >
                Ouvrir
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2FA OTP</CardTitle>
            <CardDescription>
              Statut actuel: <span className="font-semibold">{enabled ? "Activée" : "Désactivée"}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {disabledByServer ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                L&apos;OTP à deux facteurs est désactivé sur ce serveur (variable{" "}
                <code className="rounded bg-muted px-1">DISABLE_2FA</code>). Contactez l&apos;administrateur.
              </p>
            ) : !enabled ? (
              <>
                <div className="space-y-2">
                  <Label>Mot de passe actuel</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Confirme ton mot de passe"
                  />
                </div>
                <Button onClick={startSetup} disabled={loading || !password}>
                  Générer QR code
                </Button>

                {qrDataUrl && (
                  <div className="space-y-3 pt-4">
                    <img src={qrDataUrl} alt="QR Code 2FA" className="w-56 h-56 border rounded-md" />
                    {manualKey && (
                      <p className="text-sm">
                        Clé manuelle: <code>{manualKey}</code>
                      </p>
                    )}
                    <div className="space-y-2">
                      <Label>Code OTP (6 chiffres)</Label>
                      <Input
                        inputMode="numeric"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        placeholder="123456"
                      />
                    </div>
                    <Button onClick={enable} disabled={loading || otp.trim().length < 6}>
                      Activer la 2FA
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Mot de passe actuel</Label>
                  <Input
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    placeholder="Confirme ton mot de passe"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Code OTP actuel</Label>
                  <Input
                    inputMode="numeric"
                    value={disableOtp}
                    onChange={(e) => setDisableOtp(e.target.value)}
                    placeholder="123456"
                  />
                </div>
                <Button variant="destructive" onClick={disable} disabled={loading || !disablePassword || disableOtp.length < 6}>
                  Désactiver la 2FA
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

