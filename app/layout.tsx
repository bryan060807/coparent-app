import "@fontsource-variable/dm-sans/index.css";
import "@fontsource-variable/newsreader/index.css";
import "@fontsource-variable/newsreader/wght-italic.css";
import "./style.css";
import { APP_NAME } from "../lib/team-types";
export const metadata = {
  title: `${APP_NAME} · Family handoffs`,
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
