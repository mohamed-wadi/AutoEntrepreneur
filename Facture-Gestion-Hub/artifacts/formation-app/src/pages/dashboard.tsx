import { useState } from "react";
import { Layout } from "@/components/layout";
import { useGetStats, getGetStatsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Loader2, TrendingUp, FileText, AlertCircle, Building2, Landmark, BellRing, ShieldAlert, AlertTriangle } from "lucide-react";

const CNSS_RATE = 0.0226;

// ─── Plafond réglementaire auto-entrepreneur ───────────────────────────────
const PLAFOND_GLOBAL = 200_000;      // 200 000 DH / an
const PLAFOND_CABINET = 100_000;     // 100 000 DH / an par cabinet
const WARN_RATIO = 0.80;             // alerte orange à 80%

function getCurrentQuarter(monthIndex: number): "T1" | "T2" | "T3" | "T4" {
  if (monthIndex <= 2) return "T1";
  if (monthIndex <= 5) return "T2";
  if (monthIndex <= 8) return "T3";
  return "T4";
}

function getDeclarationDeadline(year: number, quarter: "T1" | "T2" | "T3" | "T4"): Date {
  if (quarter === "T1") return new Date(year, 3, 30, 23, 59, 59, 999);
  if (quarter === "T2") return new Date(year, 6, 31, 23, 59, 59, 999);
  if (quarter === "T3") return new Date(year, 9, 31, 23, 59, 59, 999);
  return new Date(year + 1, 0, 31, 23, 59, 59, 999);
}

function plafondColor(current: number, max: number) {
  const ratio = current / max;
  if (ratio >= 1)   return { bar: "bg-red-500",    text: "text-red-700",    badge: "bg-red-100 text-red-700 border-red-200" };
  if (ratio >= WARN_RATIO) return { bar: "bg-orange-400", text: "text-orange-700", badge: "bg-orange-100 text-orange-700 border-orange-200" };
  return { bar: "bg-emerald-500", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-700 border-emerald-200" };
}

export function Dashboard() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const now = new Date();
  const currentYear = now.getFullYear();
  const MIN_YEAR = 2026;
  const currentTrimestreIndex = Math.floor(now.getMonth() / 3);
  const currentTrimestreLabel = ["T1", "T2", "T3", "T4"][currentTrimestreIndex];
  
  const [selectedYear, setSelectedYear] = useState<number>(Math.max(currentYear, MIN_YEAR));

  const { data: stats, isLoading } = useGetStats({
    year: selectedYear
  }, {
    query: {
      queryKey: getGetStatsQueryKey({ year: selectedYear }),
      enabled: !!user
    }
  });

  if (isAuthLoading) return null;
  if (!user) return <Redirect to="/" />;

  const formatDH = (amount: number) => {
    return new Intl.NumberFormat('fr-MA', { 
      style: 'currency', 
      currency: 'MAD',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const byTrimestre = stats?.byTrimestre ?? [];
  const byCabinet = stats?.byCabinet ?? [];
  const currentQuarterData = byTrimestre.find((t) => t.trimestre === currentTrimestreLabel);
  const currentImpots = currentQuarterData ? currentQuarterData.totalMontant * 0.01 : 0;
  const currentCnss = currentQuarterData ? currentQuarterData.totalMontant * CNSS_RATE : 0;
  const declarationQuarter = getCurrentQuarter(now.getMonth());
  const declarationDeadline = getDeclarationDeadline(now.getFullYear(), declarationQuarter);
  const daysLeft = Math.ceil((declarationDeadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const declarationDeadlineLabel = declarationDeadline.toLocaleDateString("fr-MA", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const isOverdue = daysLeft < 0;
  const isUrgent = daysLeft <= 10;

  // ─── Calculs plafonds ────────────────────────────────────────────────────
  const caGlobal = stats?.totalMontantAnnuel ?? 0;
  const globalRatio = Math.min(caGlobal / PLAFOND_GLOBAL, 1);
  const globalColors = plafondColor(caGlobal, PLAFOND_GLOBAL);
  const globalDepassement = caGlobal >= PLAFOND_GLOBAL;
  const globalWarn = caGlobal >= PLAFOND_GLOBAL * WARN_RATIO && !globalDepassement;

  // Agréger par cabinet (cumul si même nom apparaît plusieurs fois)
  const cabinetMap = new Map<string, number>();
  for (const c of byCabinet) {
    const prev = cabinetMap.get(c.cabinetName) ?? 0;
    cabinetMap.set(c.cabinetName, prev + c.totalMontant);
  }
  const cabinetList = Array.from(cabinetMap.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

  const anyDangerCabinet = cabinetList.some(c => c.total >= PLAFOND_CABINET);
  const anyWarnCabinet = cabinetList.some(c => c.total >= PLAFOND_CABINET * WARN_RATIO && c.total < PLAFOND_CABINET);

  return (
    <Layout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">Tableau de bord</h1>
            <span className="px-3 py-1 bg-indigo-100 text-indigo-800 text-sm font-semibold rounded-full border border-indigo-200 shadow-sm animate-pulse">
              Trimestre {currentTrimestreIndex + 1} en cours
            </span>
          </div>
          <p className="text-slate-500 mt-1">Aperçu de l'activité de formation</p>
        </div>
        
        <Select 
          value={selectedYear.toString()} 
          onValueChange={(val) => setSelectedYear(parseInt(val))}
        >
          <SelectTrigger className="w-[120px]" data-testid="select-year">
            <SelectValue placeholder="Année" />
          </SelectTrigger>
          <SelectContent>
            {Array.from(
              { length: Math.max(1, (currentYear + 1) - MIN_YEAR + 1) },
              (_, i) => MIN_YEAR + i,
            ).map((year) => (
              <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : stats ? (
        <div className="space-y-8">

          {/* ── Alerte plafond global ───────────────────────────────── */}
          {(globalDepassement || anyDangerCabinet) && (
            <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 shadow-sm" data-testid="alert-plafond-danger">
              <ShieldAlert className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-red-700">⛔ Plafond dépassé — Attention !</p>
                {globalDepassement && (
                  <p className="text-sm text-red-600 mt-0.5">
                    Votre CA annuel total <strong>({formatDH(caGlobal)})</strong> dépasse le plafond auto-entrepreneur de <strong>200 000 DH</strong>.
                  </p>
                )}
                {anyDangerCabinet && (
                  <p className="text-sm text-red-600 mt-0.5">
                    Un ou plusieurs cabinets dépassent le plafond de <strong>100 000 DH</strong> par an — voir le tableau ci-dessous.
                  </p>
                )}
              </div>
            </div>
          )}

          {!globalDepassement && !anyDangerCabinet && (globalWarn || anyWarnCabinet) && (
            <div className="flex items-start gap-3 rounded-lg border border-orange-300 bg-orange-50 p-4 shadow-sm" data-testid="alert-plafond-warn">
              <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-orange-700">⚠️ Vigilance — Plafond proche</p>
                {globalWarn && (
                  <p className="text-sm text-orange-600 mt-0.5">
                    Votre CA annuel total <strong>({formatDH(caGlobal)})</strong> approche du plafond de 200 000 DH.
                  </p>
                )}
                {anyWarnCabinet && (
                  <p className="text-sm text-orange-600 mt-0.5">
                    Un ou plusieurs cabinets approchent du plafond de 100 000 DH — voir le tableau ci-dessous.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Déclaration rappel */}
          <Card className="border-red-300 bg-red-50 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base md:text-lg text-red-700 flex items-center gap-2">
                <BellRing className="h-5 w-5" />
                Rappel declaration {declarationQuarter}
              </CardTitle>
              <CardDescription className="text-red-700/90">
                {isOverdue
                  ? `Date limite depassee depuis ${Math.abs(daysLeft)} jour(s). Declarer immediatement.`
                  : `Vous devez declarer le trimestre ${declarationQuarter} avant le ${declarationDeadlineLabel}.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <p className={`text-sm font-medium ${isUrgent ? "text-red-700" : "text-red-600"}`}>
                {isOverdue ? "Retard de declaration en cours." : `Il reste ${daysLeft} jour(s) avant la date limite.`}
              </p>
            </CardContent>
          </Card>

          {/* Main KPIs */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Chiffre d'affaires</CardTitle>
                <TrendingUp className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-revenue">{formatDH(stats.totalMontantAnnuel)}</div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Factures</CardTitle>
                <FileText className="h-4 w-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-invoices">{stats.totalInvoices}</div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Impayés</CardTitle>
                <AlertCircle className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600" data-testid="stat-unpaid">{stats.unpaidCount}</div>
              </CardContent>
            </Card>
            
            <Card className="border-indigo-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Impôts en cours ({currentTrimestreLabel})</CardTitle>
                <Landmark className="h-4 w-4 text-indigo-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-indigo-600" data-testid="stat-impots">{formatDH(currentImpots)}</div>
                <p className="text-xs text-slate-400 mt-1">1% du CA de {currentTrimestreLabel}</p>
              </CardContent>
            </Card>
            
            <Card className="border-emerald-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">CNSS en cours ({currentTrimestreLabel})</CardTitle>
                <Building2 className="h-4 w-4 text-emerald-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600" data-testid="stat-cnss">{formatDH(currentCnss)}</div>
                <p className="text-xs text-slate-400 mt-1">Total CNSS calcule sur le CA de {currentTrimestreLabel}</p>
              </CardContent>
            </Card>
          </div>

          {/* ── Section Suivi des Plafonds ─────────────────────────────────── */}
          <div>
            <h2 className="text-xl font-semibold tracking-tight mb-4 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-slate-600" />
              Suivi des plafonds réglementaires {selectedYear}
            </h2>

            {/* Plafond Global */}
            <Card className={`mb-4 border-2 ${globalDepassement ? "border-red-400 bg-red-50" : globalWarn ? "border-orange-300 bg-orange-50" : "border-slate-200"}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-slate-700 text-sm">CA annuel total (plafond auto-entrepreneur)</span>
                  <span className={`text-sm font-bold px-2 py-0.5 rounded-full border ${globalColors.badge}`}>
                    {formatDH(caGlobal)} / {formatDH(PLAFOND_GLOBAL)}
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full transition-all duration-700 ${globalColors.bar}`}
                    style={{ width: `${globalRatio * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>0 DH</span>
                  <span className={globalColors.text}>
                    {Math.round(globalRatio * 100)}% utilisé — reste {formatDH(Math.max(0, PLAFOND_GLOBAL - caGlobal))}
                  </span>
                  <span>200 000 DH</span>
                </div>
              </CardContent>
            </Card>

            {/* Plafond par Cabinet — TOP 3 les plus proches du plafond */}
            {cabinetList.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-slate-600">Top 3 cabinets les plus proches du plafond (100 000 DH/an)</h3>
                  {cabinetList.length > 3 && (
                    <a href="/clients" className="text-xs text-indigo-600 hover:underline font-medium">
                      Voir les {cabinetList.length} cabinets →
                    </a>
                  )}
                </div>
                <div className="space-y-3">
                  {cabinetList.slice(0, 3).map((cab) => {
                    const ratio = Math.min(cab.total / PLAFOND_CABINET, 1);
                    const colors = plafondColor(cab.total, PLAFOND_CABINET);
                    return (
                      <Card key={cab.name} className={`border ${cab.total >= PLAFOND_CABINET ? "border-red-300 bg-red-50" : cab.total >= PLAFOND_CABINET * WARN_RATIO ? "border-orange-200 bg-orange-50" : ""}`}>
                        <CardContent className="pt-3 pb-3">
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="font-medium text-slate-700 text-sm truncate max-w-xs">{cab.name}</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${colors.badge}`}>
                              {formatDH(cab.total)} / {formatDH(PLAFOND_CABINET)}
                            </span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-2.5">
                            <div
                              className={`h-2.5 rounded-full transition-all duration-700 ${colors.bar}`}
                              style={{ width: `${ratio * 100}%` }}
                            />
                          </div>
                          <p className={`text-xs mt-1 ${colors.text}`}>
                            {Math.round(ratio * 100)}% — reste {formatDH(Math.max(0, PLAFOND_CABINET - cab.total))}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {cabinetList.length > 3 && (
                    <p className="text-xs text-slate-400 text-center pt-1">
                      + {cabinetList.length - 3} autre(s) cabinet(s) — <a href="/clients" className="text-indigo-500 hover:underline">voir la page Cabinets pour le détail complet</a>
                    </p>
                  )}
                </div>
              </>
            )}

          </div>

          {/* Trimestre Breakdown */}
          <h2 className="text-xl font-semibold tracking-tight mt-10 mb-4">Détail par Trimestre</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {byTrimestre.map((t) => (
              <Card key={t.trimestre} className="border-t-4" style={{ 
                borderTopColor: 
                  t.trimestre === 'T1' ? 'hsl(210, 100%, 60%)' : 
                  t.trimestre === 'T2' ? 'hsl(142, 71%, 45%)' : 
                  t.trimestre === 'T3' ? 'hsl(38, 92%, 50%)' : 
                  'hsl(280, 65%, 60%)'
              }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{t.trimestre}</CardTitle>
                  <CardDescription>{t.totalInvoices} factures</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold mb-4">{formatDH(t.totalMontant)}</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Payées</span>
                      <span className="font-medium text-emerald-600">{t.paidCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">En attente</span>
                      <span className="font-medium text-amber-600">{t.pendingCount}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex h-64 items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-slate-900 dark:text-slate-50 font-medium">Impossible de charger les statistiques</p>
            <p className="text-sm text-slate-500">Recharge la page. Si ça continue, vérifie que l'API répond.</p>
          </div>
        </div>
      )}
    </Layout>
  );
}