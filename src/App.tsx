import { AppShell } from "@/frontend/app-shell/AppShell";
import { L10nProvider } from "@/frontend/shared/i18n/L10nProvider";

export default function App() {
  return (
    <L10nProvider locale="it">
      <AppShell />
    </L10nProvider>
  );
}

