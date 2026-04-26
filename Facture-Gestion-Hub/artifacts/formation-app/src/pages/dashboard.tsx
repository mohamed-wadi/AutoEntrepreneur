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
import { Loader2, TrendingUp, FileText, AlertCircle, Building2, Landmark } from "lucide-react";

const CNSS_RATE = 0.0226;

export function Dashboard() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const currentYear = new Date().getFullYear();
  const currentTrimestreIndex = Math.floor(new Date().getMonth() / 3);
  const currentTrimestreLabel = ["T1", "T2", "T3", "T4"][currentTrimestreIndex];
  
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

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
  const currentQuarterData = byTrimestre.find((t) => t.trimestre === currentTrimestreLabel);
  const currentImpots = currentQuarterData ? currentQuarterData.totalMontant * 0.01 : 0;
  const currentCnss = currentQuarterData ? currentQuarterData.totalMontant * CNSS_RATE : 0;

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
            {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map(year => (
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
            <p className="text-sm text-slate-500">Recharge la page. Si ça continue, vérifie que l’API répond.</p>
          </div>
        </div>
      )}
    </Layout>
  );
}