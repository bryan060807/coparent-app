import "./style.css";
export const metadata = {
  title: "Two Homes · Papers, pickups & homework",
  description:
    "Shared school papers, pickup plans, and homework between two homes.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
