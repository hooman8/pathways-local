import { redirect } from "next/navigation";

// Old bookmarks open the local workspace directly.
export default function LoginPage() { redirect("/"); }
