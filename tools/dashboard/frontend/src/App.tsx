import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { BelegePage } from "@/pages/belege-page";
import { BelegDetailPage } from "@/pages/beleg-detail-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { OpsPage } from "@/pages/ops-page";
import { TaxPage } from "@/pages/tax-page";
import { StatementDetailPage } from "@/pages/statement-detail-page";
import { TransactionsPage } from "@/pages/transactions-page";
import { TransactionDetailPage } from "@/pages/transaction-detail-page";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/belege" element={<BelegePage />} />
        <Route path="/belege/:documentId" element={<BelegDetailPage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/transactions/:transactionId" element={<TransactionDetailPage />} />
        <Route path="/kontoauszuege/:statementDocId" element={<StatementDetailPage />} />
        <Route path="/tax" element={<TaxPage />} />
        <Route path="/ops" element={<OpsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
