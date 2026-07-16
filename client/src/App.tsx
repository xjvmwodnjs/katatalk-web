import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

const Home = lazy(() => import("./pages/Home"));
const LoginPage = lazy(() => import("./pages/Login"));
const Pricing = lazy(() => import("./pages/Pricing"));
const NotFound = lazy(() => import("./pages/NotFound"));

/** nest 사용 시 하위 경로에서 useLocation 이 상대 경로가 되어 SignUp 분기가 깨지므로, 정규식으로만 매칭한다. */
const LOGIN_PATH = /^\/login(\/.*)?$/;
const SIGN_UP_PATH = /^\/sign-up(\/.*)?$/;

function Router() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <Switch>
        <Route path={"/"}>{() => <Home />}</Route>
        <Route path={LOGIN_PATH}>{() => <LoginPage />}</Route>
        <Route path={SIGN_UP_PATH}>{() => <LoginPage />}</Route>
        <Route path={"/pricing"}>{() => <Pricing />}</Route>
        <Route path={"/404"}>{() => <NotFound />}</Route>
        {/* Final fallback route */}
        <Route>{() => <NotFound />}</Route>
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
