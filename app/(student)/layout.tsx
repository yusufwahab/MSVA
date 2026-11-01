import { AppShell } from "@/components/AppShell";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <AppShell role="STUDENT">{children}</AppShell>;
}
