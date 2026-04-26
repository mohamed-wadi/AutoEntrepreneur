import { useEffect, useMemo, useState } from "react";
import { Redirect } from "wouter";
import { Layout } from "@/components/layout";
import { API_BASE } from "@/lib/api-base";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload } from "lucide-react";

type TwoFaStatus = { enabled?: boolean; disabledByServer?: boolean };

export function SettingsPage() {
  const { user, setUser, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();

  const envDrive = (import.meta as any).env?.VITE_DRIVE_FOLDER_URL as string | undefined;
  const [driveLink, setDriveLink] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("driveFolderUrl") ?? (envDrive ?? "");
  });

  const [twoFa, setTwoFa] = useState<TwoFaStatus>({});

  const [newUsername, setNewUsername] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profilePassword, setProfilePassword] = useState("");
  const [profileOtp, setProfileOtp] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [passwordOtp, setPasswordOtp] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    setNewUsername(user.username ?? "");
    setAvatarUrl(user.avatarUrl ?? "");
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetch(`${API_BASE}/api/auth/2fa/status`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: TwoFaStatus) => setTwoFa(d ?? {}))
      .catch(() => setTwoFa({}));
  }, [user]);

  const otpRequired = useMemo(() => Boolean(twoFa.enabled) && !Boolean(twoFa.disabledByServer), [twoFa]);

  const saveDriveLink = () => {
    const u = driveLink.trim();
    if (typeof window !== "undefined") {
      window.localStorage.setItem("driveFolderUrl", u);
    }
    toast({ title: "Lien Drive enregistré" });
  };

  const openDrive = () => {
    const u = driveLink.trim();
    window.open(u || "https://drive.google.com", "_blank", "noopener,noreferrer");
  };

  const inferUploadContentType = (file: File): string => {
    if (file.type) return file.type;
    if (file.name.toLowerCase().endsWith(".png")) return "image/png";
    if (file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg")) return "image/jpeg";
    if (file.name.toLowerCase().endsWith(".webp")) return "image/webp";
    return "application/octet-stream";
  };

  const requestUploadUrl = async (file: File): Promise<{ uploadURL: string; objectPath: string }> => {
    const res = await fetch(`${API_BASE}/api/storage/uploads/request-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        contentType: inferUploadContentType(file),
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string; uploadURL?: string; objectPath?: string };
    if (!res.ok) throw new Error(payload.error || "Impossible d'obtenir l'URL d'upload");
    if (!payload.uploadURL || !payload.objectPath) throw new Error("Réponse serveur invalide");
    return { uploadURL: payload.uploadURL, objectPath: payload.objectPath };
  };

  const uploadToStorage = async (file: File, uploadURL: string): Promise<void> => {
    const baseOrigin = (() => {
      try {
        return new URL(API_BASE || window.location.origin).origin;
      } catch {
        return window.location.origin;
      }
    })();
    const absolute =
      uploadURL.startsWith("http://") || uploadURL.startsWith("https://")
        ? uploadURL
        : new URL(uploadURL, baseOrigin).href;
    const isThirdParty = absolute.startsWith("http") && new URL(absolute).origin !== baseOrigin;
    const res = await fetch(absolute, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": inferUploadContentType(file) },
      credentials: isThirdParty ? "omit" : "include",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(detail || "Échec de l'envoi de l'image");
    }
  };

  const handleAvatarFile = async (file: File) => {
    const contentType = inferUploadContentType(file);
    if (!contentType.startsWith("image/")) {
      toast({ variant: "destructive", title: "Format invalide", description: "Choisis une image (jpg, png, webp...)." });
      return;
    }
    setUploadingAvatar(true);
    try {
      const { uploadURL, objectPath } = await requestUploadUrl(file);
      await uploadToStorage(file, uploadURL);
      const fileUrl = `${API_BASE}/api/storage${objectPath}?filename=${encodeURIComponent(file.name)}`;
      setAvatarUrl(fileUrl);
      toast({ title: "Image importée", description: "Clique sur 'Enregistrer le profil' pour confirmer." });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Upload impossible",
        description: e instanceof Error ? e.message : "Erreur",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const saveProfile = async () => {
    const target = newUsername.trim().toLowerCase();
    if (!target) {
      toast({ variant: "destructive", title: "Nom invalide" });
      return;
    }
    setSavingProfile(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: target,
          avatarUrl: avatarUrl.trim(),
          password: profilePassword,
          otp: otpRequired ? profileOtp : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Impossible de modifier le profil");
      setUser(data);
      toast({ title: "Profil mis à jour" });
      setProfilePassword("");
      setProfileOtp("");
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: e instanceof Error ? e.message : "Erreur",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (!currentPassword.trim() || !newPassword.trim()) {
      toast({ variant: "destructive", title: "Champs requis" });
      return;
    }
    if (newPassword !== newPassword2) {
      toast({ variant: "destructive", title: "Le nouveau mot de passe ne correspond pas" });
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          currentPassword,
          newPassword,
          otp: otpRequired ? passwordOtp : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Impossible de changer le mot de passe");
      toast({ title: "Mot de passe mis à jour" });
      setCurrentPassword("");
      setNewPassword("");
      setNewPassword2("");
      setPasswordOtp("");
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: e instanceof Error ? e.message : "Erreur",
      });
    } finally {
      setSavingPassword(false);
    }
  };

  if (isAuthLoading) return null;
  if (!user) return <Redirect to="/" />;

  return (
    <Layout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Paramètres</h1>
          <p className="text-slate-500 mt-1">Profil, Drive, et mot de passe.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Profil</CardTitle>
            <CardDescription>Ton nom de connexion (admin ou viewer).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="avatar-url">Image de profil (URL)</Label>
              <Input
                id="avatar-url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://.../photo.jpg"
              />
              <div>
                <input
                  id="avatar-file"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleAvatarFile(f);
                    e.currentTarget.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.getElementById("avatar-file")?.click()}
                  disabled={uploadingAvatar}
                >
                  {uploadingAvatar ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Upload image...</>
                  ) : (
                    <><Upload className="h-4 w-4 mr-2" />Importer depuis mon PC</>
                  )}
                </Button>
              </div>
              {avatarUrl.trim() ? (
                <img
                  src={avatarUrl}
                  alt="Aperçu avatar"
                  className="w-16 h-16 rounded-full object-cover border"
                />
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Nom (username)</Label>
              <Input id="username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-password">Mot de passe actuel</Label>
              <Input
                id="profile-password"
                type="password"
                value={profilePassword}
                onChange={(e) => setProfilePassword(e.target.value)}
                placeholder="Obligatoire"
              />
            </div>
            {otpRequired ? (
              <div className="space-y-2">
                <Label htmlFor="profile-otp">OTP</Label>
                <Input id="profile-otp" inputMode="numeric" value={profileOtp} onChange={(e) => setProfileOtp(e.target.value)} placeholder="123456" />
              </div>
            ) : null}
            <Button onClick={saveProfile} disabled={savingProfile || !profilePassword.trim() || (otpRequired && profileOtp.trim().length < 6)}>
              Enregistrer le profil
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Google Drive</CardTitle>
            <CardDescription>Le bouton “Drive” ouvre ce lien.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="drive-link">Lien Drive</Label>
              <Input
                id="drive-link"
                value={driveLink}
                onChange={(e) => setDriveLink(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/..."
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={saveDriveLink} disabled={!driveLink.trim()}>
                Enregistrer
              </Button>
              <Button type="button" onClick={openDrive} disabled={!driveLink.trim()}>
                Ouvrir
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Auto entrepreneur</CardTitle>
            <CardDescription>Lien fixe officiel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input value="https://rn.ae.gov.ma/login" readOnly />
            <Button
              type="button"
              onClick={() => window.open("https://rn.ae.gov.ma/login", "_blank", "noopener,noreferrer")}
            >
              Ouvrir Auto entrepreneur
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mot de passe</CardTitle>
            <CardDescription>Changement de mot de passe (OTP requis si 2FA activée).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-pass">Mot de passe actuel</Label>
              <Input id="current-pass" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pass">Nouveau mot de passe</Label>
              <Input id="new-pass" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-pass2">Confirmer le nouveau mot de passe</Label>
              <Input id="new-pass2" type="password" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} />
            </div>
            {otpRequired ? (
              <div className="space-y-2">
                <Label htmlFor="pass-otp">OTP</Label>
                <Input id="pass-otp" inputMode="numeric" value={passwordOtp} onChange={(e) => setPasswordOtp(e.target.value)} placeholder="123456" />
              </div>
            ) : null}
            <Button onClick={changePassword} disabled={savingPassword || (otpRequired && passwordOtp.trim().length < 6)}>
              Changer le mot de passe
            </Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

