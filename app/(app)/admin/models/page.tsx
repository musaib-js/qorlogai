import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteModelButton, ModelDialog } from "@/components/admin/model-dialog";
import { adminListModels } from "@/lib/data/admin";

export const metadata = { title: "Model catalog" };

export default async function AdminModels() {
  const models = await adminListModels();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Model catalog</h1>
          <p className="text-sm text-muted-foreground">The AI models Qorlog agents may use, and which one is the default for each job.</p>
        </div>
        <ModelDialog />
      </div>
      <Card className="py-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Serves</TableHead>
              <TableHead>Default for</TableHead>
              <TableHead className="text-right">Context</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  The catalog is empty. Agents fall back to the DEFAULT_*_MODEL environment variables. Run <code className="font-mono">npm run db:seed</code> or add a model.
                </TableCell>
              </TableRow>
            )}
            {models.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="font-medium">{m.displayName}</div>
                  <div className="font-mono text-xs text-muted-foreground">{m.modelId}</div>
                  {m.notes && <div className="mt-0.5 max-w-xs text-xs text-muted-foreground">{m.notes}</div>}
                </TableCell>
                <TableCell className="text-muted-foreground">{m.provider}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {m.purposes.map((p) => (
                      <Badge key={p} variant="secondary">{p}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {m.defaultFor.length ? m.defaultFor.map((p) => <Badge key={p}>{p}</Badge>) : <span className="text-muted-foreground">-</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">{m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : "-"}</TableCell>
                <TableCell>
                  <Badge variant={m.enabled ? "success" : "secondary"}>{m.enabled ? "enabled" : "disabled"}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <ModelDialog model={m} />
                    <DeleteModelButton id={m.id} name={m.displayName} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">Only Groq models are wired up today. Other providers can be recorded here for planning but agents will skip them.</p>
    </div>
  );
}
