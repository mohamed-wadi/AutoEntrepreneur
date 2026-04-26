import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useLogout } from "@workspace/api-client-react";
import {
  LayoutDashboard,
  FileText,
  Users,
  FileCheck,
  LogOut,
  GraduationCap,
  Folder,
  Settings,
  ShieldCheck,
  HardDrive,
  Globe,
  Menu,
} from "lucide-react";
import { Button } from "./ui/button";
import { BrandLogo } from "./brand-logo";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, setUser } = useAuth();
  const logout = useLogout();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const driveUrl = (() => {
    if (typeof window === "undefined") return "https://drive.google.com";
    const saved = window.localStorage.getItem("driveFolderUrl");
    const envDefault = (import.meta as any).env?.VITE_DRIVE_FOLDER_URL as string | undefined;
    return (
      (saved && saved.trim()) ||
      (envDefault && envDefault.trim()) ||
      "https://drive.google.com/drive/folders/1PDLAU2Mfz1G8JL1QES6C6pNDJldDKvrQ?usp=sharing"
    );
  })();

  const openDrive = () => {
    setMobileNavOpen(false);
    window.open(driveUrl, "_blank", "noopener,noreferrer");
  };
  const openAutoEntrepreneur = () => {
    setMobileNavOpen(false);
    window.open("https://rn.ae.gov.ma/login", "_blank", "noopener,noreferrer");
  };

  const handleLogout = () => {
    setMobileNavOpen(false);
    logout.mutate(undefined, {
      onSuccess: () => {
        setUser(null);
      },
    });
  };

  const navItems = [
    { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard, show: true },
    { href: "/invoices", label: "Factures", icon: FileText, show: true },
    { href: "/cabinets", label: "Cabinets", icon: Users, show: user?.role === "admin" },
    { href: "/formations", label: "Formations", icon: GraduationCap, show: user?.role === "admin" },
    { href: "/declarations", label: "Déclarations", icon: FileCheck, show: true },
    { href: "/files", label: "Mes Fichiers", icon: Folder, show: true },
    { href: "__drive__", label: "Drive", icon: HardDrive, show: true },
    { href: "__auto_entrepreneur__", label: "Auto entrepreneur", icon: Globe, show: true },
    { href: "/settings", label: "Paramètres", icon: Settings, show: true },
    { href: "/security", label: "Sécurité", icon: ShieldCheck, show: true },
  ];

  const visibleNav = navItems.filter((item) => item.show);

  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-slate-950">
      {/* Sidebar — desktop */}
      <aside className="w-64 border-r bg-white dark:bg-slate-900 flex-col hidden md:flex">
        <div className="h-16 flex items-center px-4 border-b shrink-0">
          <Link
            href="/dashboard"
            className="block rounded-md outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            title="Tableau de bord"
          >
            <BrandLogo className="h-12 max-w-[220px] cursor-pointer hover:opacity-90 transition-opacity" />
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {visibleNav.map((item) => {
            const isActive = location === item.href;
            const isDrive = item.href === "__drive__";
            const isAutoEntrepreneur = item.href === "__auto_entrepreneur__";
            return (
              isDrive || isAutoEntrepreneur ? (
                <Button
                  key={item.href}
                  type="button"
                  variant="ghost"
                  onClick={isDrive ? openDrive : openAutoEntrepreneur}
                  className="w-full justify-start font-normal text-slate-600 dark:text-slate-400"
                  data-testid={isDrive ? "nav-drive" : "nav-auto-entrepreneur"}
                  title={isDrive ? driveUrl : "https://rn.ae.gov.ma/login"}
                >
                  <item.icon className="h-4 w-4 mr-3 shrink-0" />
                  {item.label}
                </Button>
              ) : (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    className={`w-full justify-start ${isActive ? "font-medium" : "font-normal text-slate-600 dark:text-slate-400"}`}
                    data-testid={`nav-${item.label.toLowerCase()}`}
                  >
                    <item.icon className="h-4 w-4 mr-3 shrink-0" />
                    {item.label}
                  </Button>
                </Link>
              )
            );
          })}
        </nav>

        <div className="p-4 border-t shrink-0">
          <div className="flex items-center mb-4 px-2">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt="Photo de profil"
                className="w-8 h-8 rounded-full object-cover mr-3 shrink-0 border"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium mr-3 shrink-0">
                {(user?.username ?? "?").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="overflow-hidden min-w-0">
              <p className="text-sm font-medium truncate">{user?.username}</p>
              <p className="text-xs text-slate-500 capitalize">{user?.role}</p>
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
            onClick={handleLogout}
            data-testid="btn-logout"
          >
            <LogOut className="h-4 w-4 mr-3 shrink-0" />
            Déconnexion
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 sm:h-16 border-b bg-white dark:bg-slate-900 flex items-center justify-between gap-2 px-3 sm:px-4 md:hidden shrink-0">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <div className="flex-1 min-w-0">
              <Link href="/dashboard" title="Tableau de bord" className="block min-w-0 py-1">
                <BrandLogo className="h-9 sm:h-10 max-w-[min(100%,200px)]" />
              </Link>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Se déconnecter"
                onClick={handleLogout}
              >
                <LogOut className="h-5 w-5" />
              </Button>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Ouvrir le menu"
                >
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
            </div>
            <SheetContent side="left" className="w-[min(100vw-2rem,20rem)] p-0 flex flex-col bg-white dark:bg-slate-900">
              <SheetHeader className="px-4 py-4 border-b text-left space-y-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Link
                  href="/dashboard"
                  onClick={() => setMobileNavOpen(false)}
                  className="block rounded-md outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring w-fit"
                  title="Tableau de bord"
                >
                  <BrandLogo className="h-10 max-w-[200px]" />
                </Link>
              </SheetHeader>
              <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-1">
                {visibleNav.map((item) => {
                  const isActive = location === item.href;
                  const isDrive = item.href === "__drive__";
                  const isAutoEntrepreneur = item.href === "__auto_entrepreneur__";
                  return (
                    isDrive || isAutoEntrepreneur ? (
                      <Button
                        key={item.href}
                        type="button"
                        variant="ghost"
                        onClick={isDrive ? openDrive : openAutoEntrepreneur}
                        className="w-full justify-start font-normal text-slate-600 dark:text-slate-400"
                        data-testid={isDrive ? "nav-mobile-drive" : "nav-mobile-auto-entrepreneur"}
                        title={isDrive ? driveUrl : "https://rn.ae.gov.ma/login"}
                      >
                        <item.icon className="h-4 w-4 mr-3 shrink-0" />
                        {item.label}
                      </Button>
                    ) : (
                      <Link key={item.href} href={item.href} onClick={() => setMobileNavOpen(false)}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className={`w-full justify-start ${isActive ? "font-medium" : "font-normal text-slate-600 dark:text-slate-400"}`}
                          data-testid={`nav-mobile-${item.label.toLowerCase()}`}
                        >
                          <item.icon className="h-4 w-4 mr-3 shrink-0" />
                          {item.label}
                        </Button>
                      </Link>
                    )
                  );
                })}
              </nav>
              <div className="p-4 border-t mt-auto shrink-0">
                <div className="flex items-center mb-3 px-1">
                  {user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt="Photo de profil"
                      className="w-8 h-8 rounded-full object-cover mr-3 shrink-0 border"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium mr-3 shrink-0">
                      {(user?.username ?? "?").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="overflow-hidden min-w-0">
                    <p className="text-sm font-medium truncate">{user?.username}</p>
                    <p className="text-xs text-slate-500 capitalize">{user?.role}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={handleLogout}
                  data-testid="btn-logout-mobile"
                >
                  <LogOut className="h-4 w-4 mr-3 shrink-0" />
                  Déconnexion
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}