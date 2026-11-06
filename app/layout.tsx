import "./style.css";
export const metadata = {
  title: "Two Homes · School papers",
  description: "A shared place for the backpack handoff.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
