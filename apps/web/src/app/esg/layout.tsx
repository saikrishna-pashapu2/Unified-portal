import Header from "@/components/header/Header";

export default function EsgLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header domain="esg" />
      <div className="min-h-[calc(100vh-64px)]">{children}</div>
    </>
  );
}
