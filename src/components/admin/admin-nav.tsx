"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  CheckSquare,
  UserSearch,
  MailCheck,
  Building2,
  Camera,
  Sparkles,
  Calendar,
  TrendingUp,
  Users,
  Award,
  Briefcase,
  Gift,
  BarChart3,
  Contact,
  PanelLeftClose,
  PanelLeft,
  type LucideIcon,
} from "lucide-react";

export interface AdminNavLabels {
  dashboard: string;
  tasks: string;
  buyerLeads: string;
  sellerLeads: string;
  crm: string;
  listings: string;
  photography: string;
  virtualStaging: string;
  consultations: string;
  transactions: string;
  users: string;
  agents: string;
  investorClub: string;
  referrals: string;
  analytics: string;
  logOut: string;
  expand: string;
  collapse: string;
}

interface NavItem {
  label: keyof AdminNavLabels;
  segment: string; // "" for the dashboard root
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { label: "dashboard", segment: "", icon: Home },
  { label: "tasks", segment: "tasks", icon: CheckSquare },
  { label: "buyerLeads", segment: "buyer-leads", icon: UserSearch },
  { label: "sellerLeads", segment: "seller-leads", icon: MailCheck },
  { label: "crm", segment: "crm", icon: Contact },
  { label: "listings", segment: "listings", icon: Building2 },
  { label: "photography", segment: "photography", icon: Camera },
  { label: "virtualStaging", segment: "virtual-staging", icon: Sparkles },
  { label: "consultations", segment: "consultations", icon: Calendar },
  { label: "transactions", segment: "transactions", icon: TrendingUp },
  { label: "users", segment: "users", icon: Users },
  { label: "agents", segment: "agents", icon: Award },
  { label: "investorClub", segment: "investor-club", icon: Briefcase },
  { label: "referrals", segment: "referrals", icon: Gift },
  { label: "analytics", segment: "analytics", icon: BarChart3 },
];

interface Props {
  lang: string;
  pendingTasks: number;
  labels: AdminNavLabels;
}

export function AdminNav({ lang, pendingTasks, labels }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const base = `/${lang}/admin`;

  return (
    <nav
      className={`shrink-0 border-r border-gold-soft bg-ivory-strong/30 flex flex-col ${
        collapsed ? "w-16" : "w-60"
      } transition-[width]`}
    >
      <div className="flex items-center justify-between px-4 h-14 border-b border-gold-soft">
        {!collapsed && (
          <span className="font-display italic text-xl text-ink leading-none">
            Lixtara
          </span>
        )}
        <button
          type="button"
          aria-label={collapsed ? labels.expand : labels.collapse}
          onClick={() => setCollapsed((v) => !v)}
          className="text-ink/55 hover:text-gold transition-colors"
        >
          {collapsed ? (
            <PanelLeft className="w-5 h-5" />
          ) : (
            <PanelLeftClose className="w-5 h-5" />
          )}
        </button>
      </div>

      <ul className="flex flex-col gap-0.5 py-3 overflow-y-auto">
        {NAV.map((item) => {
          const href = item.segment ? `${base}/${item.segment}` : base;
          const active =
            item.segment === ""
              ? pathname === base
              : pathname.startsWith(href);
          const Icon = item.icon;
          const badge = item.segment === "tasks" && pendingTasks > 0;
          return (
            <li key={item.segment || "dashboard"}>
              <Link
                href={href}
                title={labels[item.label]}
                className={`flex items-center gap-3 px-4 py-2.5 text-xs tracking-wide transition-colors ${
                  active
                    ? "bg-gold/10 text-ink border-l-2 border-gold"
                    : "text-ink/70 hover:bg-gold/5 hover:text-ink border-l-2 border-transparent"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="flex-1">{labels[item.label]}</span>}
                {badge && (
                  <span
                    className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-gold text-ivory ${
                      collapsed ? "absolute ml-6 -mt-4" : ""
                    }`}
                  >
                    {pendingTasks}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <form
        action={`/${lang}/auth/sign-out`}
        method="POST"
        className="mt-auto border-t border-gold-soft p-3"
      >
        <button
          type="submit"
          className="w-full text-left text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors px-1 py-2"
        >
          {collapsed ? "↩" : labels.logOut}
        </button>
      </form>
    </nav>
  );
}
