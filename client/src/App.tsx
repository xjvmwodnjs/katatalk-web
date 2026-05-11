import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import LoginPage from "./pages/Login";
import Pricing from "./pages/Pricing";

/** nest 사용 시 하위 경로에서 useLocation 이 상대 경로가 되어 SignUp 분기가 깨지므로, 정규식으로만 매칭한다. */
const LOGIN_PATH = /^\/login(\/.*)?$/;
const SIGN_UP_PATH = /^\/sign-up(\/.*)?$/;

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={LOGIN_PATH} component={LoginPage} />
      <Route path={SIGN_UP_PATH} component={LoginPage} />
      <Route path={"/pricing"} component={Pricing} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
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
