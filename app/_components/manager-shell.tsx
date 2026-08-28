"use client";

import { KeyRoundIcon, PanelsTopLeftIcon } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AccountControl } from "./account-control";

const managerNavigation = [
  { href: "/", icon: PanelsTopLeftIcon, id: "workspace", label: "Workspace" },
  { href: "/vault", icon: KeyRoundIcon, id: "vault", label: "Vault" },
] as const;

const managerSidebarStyle: CSSProperties & { "--sidebar-width": string } = {
  "--sidebar-width": "12rem",
};

export function ManagerShell({
  active,
  children,
}: {
  readonly active: "vault" | "workspace";
  readonly children: ReactNode;
}) {
  const activeItem = managerNavigation.find((item) => item.id === active);

  return (
    <SidebarProvider style={managerSidebarStyle}>
      <Sidebar>
        <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
          <Link aria-label="Workspace" className="w-fit" href="/">
            <Logo className="size-7" />
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {managerNavigation.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={isActive}
                      render={<Link href={item.href} />}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-0">
          <AccountControl />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-12 items-center gap-2 border-b border-border/50 px-4 md:hidden">
          <SidebarTrigger />
          <span className="type-label">{activeItem?.label}</span>
        </header>
        <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
