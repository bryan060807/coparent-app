import "./style.css";
export const metadata = {
  title: "Two Homes · Family handoffs",
  description:
    "Shared plans, school work, routines, gifts, and family information between two homes.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
