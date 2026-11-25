import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { localStore } from "@/lib/local-client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app/app-sidebar";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar  />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur">
            <SidebarTrigger />
            <span className="text-sm text-muted-foreground">Un Instant Chez Moi · décoration & mobilier</span>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
