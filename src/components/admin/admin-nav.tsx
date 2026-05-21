"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  CheckSquare,
  UserSearch,
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
  PanelLeftClose,
  PanelLeft,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  title: string;
  segment: string; // "" for the dashboard root
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { title: "Dashboard", segment: "", icon: Home },
  { title: "Tasks", segment: "tasks", icon: CheckSquare },
  { title: "Buyer Leads", segment: "buyer-leads", icon: UserSearch },
  { title: "Listings", segment: "listings", icon: Building2 },
  { title: "Photography", segment: "photography", icon: Camera },
  { title: "Virtual Staging", segment: "virtual-staging", icon: Sparkles },
  { title: "Consultations", segment: "consultations", icon: Calendar },
  { title: "Transactions", segment: "transactions", icon: TrendingUp },
  { title: "Users", segment: "users", icon: Users },
  { title: "Partner Agents", segment: "agents", icon: Award },
  { title: "Investor Club", segment: "investor-club", icon: Briefcase },
  { title: "Referrals", segment: "referrals", icon: Gift },
  { title: "Analytics", segment: "analytics", icon: BarChart3 },
];

interface Props {
  lang: string;
  pendingTasks: number;
}

export function AdminNav({ lang, pendingTasks }: Props) {
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
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
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
                title={item.title}
                className={`flex items-center gap-3 px-4 py-2.5 text-xs tracking-wide transition-colors ${
                  active
                    ? "bg-gold/10 text-ink border-l-2 border-gold"
                    : "text-ink/70 hover:bg-gold/5 hover:text-ink border-l-2 border-transparent"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="flex-1">{item.title}</span>}
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
          {collapsed ? "↩" : "Log out"}
        </button>
      </form>
    </nav>
  );
}
