import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/belege", label: "Belege" },
  { to: "/transactions", label: "Transaktionen" },
  { to: "/tax", label: "Steuer/MwSt" },
  { to: "/ops", label: "Import/Ops" },
];

export function AppShell() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">BitMechanics Buchhaltungs-Dashboard</h1>
            <p className="text-xs text-muted-foreground">SQLite-basierte Auswertung für Import, Salden und Transaktionen</p>
          </div>
          <nav className="flex gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition",
                    isActive ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="container py-6">
        <Outlet />
      </main>
    </div>
  );
}
