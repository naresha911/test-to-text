import { CircleHelp } from "lucide-react";

import { MathText } from "@/components/MathText";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const EXAMPLES: { label: string; value: string }[] = [
  { label: "Fraction", value: "$\\frac{2}{3}$" },
  { label: "Several fractions", value: "$\\frac{2}{3}$, $\\frac{4}{5}$, $0.5$" },
  { label: "Mixed number", value: "$2\\frac{1}{3}$" },
  {
    label: "Arithmetic line",
    value:
      "$2\\frac{1}{3} + 1\\frac{1}{2} - 2\\frac{1}{4} \\times 3\\frac{1}{2} \\div \\frac{7}{2} = ?$",
  },
  { label: "In a sentence", value: "spent $\\frac{3}{4}$ of his time" },
  { label: "Degree", value: "$90^{\\circ}$" },
  { label: "Square centimetres", value: "$3600\\text{ cm}^{2}$" },
  { label: "Percent in a sentence", value: "25%" },
  { label: "Percent in a formula", value: "$25\\%$" },
];

/** Reference for the strings typed into a question. Stays on this page. */
export function MathFormatHelp() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
          <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
          Math format
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Math format</DialogTitle>
          <DialogDescription>
            Type these strings in the stem, options, hint, and explanation. Words stay outside the
            dollar signs. Use <span className="font-mono">$...$</span> inside a sentence, and{" "}
            <span className="font-mono">$$...$$</span> when a formula stands on its own line.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-[7.5rem_1fr_1fr] gap-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Kind
            </p>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Type this
            </p>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Looks like
            </p>
          </div>
          {EXAMPLES.map((example) => (
            <div
              key={example.label}
              className="grid grid-cols-[7.5rem_1fr_1fr] items-start gap-3 border-t border-border pt-3"
            >
              <p className="text-muted-foreground">{example.label}</p>
              <code className="min-w-0 break-all text-xs leading-relaxed">{example.value}</code>
              <MathText value={example.value} className="min-w-0" />
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          The same strings go in the options, the hint, and the explanation. A percent inside{" "}
          <span className="font-mono">$...$</span> is written <span className="font-mono">\%</span>.
          Outside a formula, type <span className="font-mono">25%</span>.
        </p>
      </DialogContent>
    </Dialog>
  );
}
