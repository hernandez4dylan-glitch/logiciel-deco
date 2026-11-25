import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Globe, LayoutDashboard, Download, Package, Palette, Receipt, ShoppingBag, Truck } from "lucide-react";
import { localStore } from "@/lib/local-client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Tableau de bord", url: "/tableau-de-bord", icon: LayoutDashboard },
  { title: "Catalogue & Stock", url: "/catalogue", icon: Package },
  { title: "Fournisseurs", url: "/fournisseurs", icon: Truck },
  { title: "Devis & Ventes", url: "/ventes", icon: ShoppingBag },
  { title: "Frais & Dépenses", url: "/depenses", icon: Receipt },
  { title: "Espace Pro Décorateurs", url: "/espace-pro", icon: Palette },
  { title: "Passerelle E-commerce", url: "/passerelle-ecommerce", icon: Globe },
] as const;

export function AppSidebar({ email }: { email?: string | undefined }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary font-display text-lg text-sidebar-primary-foreground">
            U
          </span>
          {!collapsed && (
            <div className="leading-tight">
              <p className="font-display text-lg text-sidebar-accent-foreground">Un Instant Chez Moi</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
                Gestion boutique
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {items.map((item) => {
                const active = pathname === item.url;
                return (
                  <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={item.title}
                    className="h-10 data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground"
                  >
                    <Link to={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {!collapsed && email && (
              <p className="truncate px-2 pb-1 text-xs text-sidebar-foreground/60">{email}</p>
            )}
            <SidebarMenuButton asChild tooltip="Sauvegarder"><a href="/api/backup" download>
              <Download />
              <span>Sauvegarder la boutique</span></a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
