import { WorkerApp } from "@/components/worker/WorkerApp";

export default async function WorkerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <WorkerApp token={token} />;
}
