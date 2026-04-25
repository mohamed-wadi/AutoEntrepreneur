import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AuthProvider } from "@/lib/auth";
import { Dashboard } from "@/pages/dashboard";
import { Login } from "@/pages/login";
import { Invoices } from "@/pages/invoices";
import { Clients } from "@/pages/clients";
import { Declarations } from "@/pages/declarations";
import { Formations } from "@/pages/formations";
import { Files } from "@/pages/files";
import { SecurityPage } from "@/pages/security";
import { API_BASE } from "@/lib/api-base";
import { setBaseUrl } from "@workspace/api-client-react";

// Ensure generated API client calls the correct backend (HF in prod, Vite proxy in dev).
setBaseUrl(API_BASE || null);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/cabinets" component={Clients} />
      <Route path="/clients">
        <Redirect to="/cabinets" />
      </Route>
      <Route path="/formations" component={Formations} />
      <Route path="/declarations" component={Declarations} />
      <Route path="/files" component={Files} />
      <Route path="/security" component={SecurityPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
