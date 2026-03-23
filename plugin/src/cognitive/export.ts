import * as fs from "node:fs";
import * as path from "node:path";

export interface ExportResult {
  found: boolean;
  content?: string;
  path?: string;
  message?: string;
}

const RUNS_DIR = "clawvitals/runs";

export function getLatestReport(workspaceDir: string, format: "markdown" | "path" = "markdown"): ExportResult {
  const runsPath = path.join(workspaceDir, RUNS_DIR);
  try {
    const entries = fs.readdirSync(runsPath).sort();
    if (entries.length === 0) {
      return { found: false, message: "No scan history yet. Run clawvitals first." };
    }

    const rawLatest = entries[entries.length - 1];
    // B2: Validate the entry name to prevent path traversal
    const safeLatest = path.basename(rawLatest);
    const latestDir = path.resolve(path.join(runsPath, safeLatest));
    const resolvedRunsPath = path.resolve(runsPath);
    if (!latestDir.startsWith(resolvedRunsPath + path.sep) && latestDir !== resolvedRunsPath) {
      return { found: false, message: "Invalid scan directory name detected." };
    }

    if (format === "path") {
      return { found: true, path: latestDir };
    }

    const reportPath = path.join(latestDir, "report.txt");
    const content = fs.readFileSync(reportPath, "utf8");
    return { found: true, content };
  } catch {
    return { found: false, message: "No scan history yet. Run clawvitals first." };
  }
}
