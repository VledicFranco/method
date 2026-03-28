// ============================================================================
// Monitor Report DSL — PEG Grammar (peggy format)
// ============================================================================
//
// Encodes MonitorReport as a compact, line-oriented DSL suitable for SLM
// generation. The format has a fixed section order:
//
//   ANOMALIES: none | <anomaly-lines>
//   ESCALATE: none | "<message>"
//   RESTRICT: none | <comma-separated actions>
//   REPLAN: yes | no
//
// Each section is on its own line (or lines, for anomalies with entries).
// Lines are separated by \n. Trailing newline is optional.
//
// Example (clean report):
//   ANOMALIES: none
//   ESCALATE: none
//   RESTRICT: none
//   REPLAN: no
//
// Example (compound anomaly):
//   ANOMALIES:
//   @reasoner low-confidence "Confidence 0.1 below threshold 0.3"
//   @actor unexpected-result "Actor reported unexpected result"
//   @llm-monitor compound "Compound anomaly: low confidence combined with unexpected result"
//   ESCALATE: "Compound anomaly: low confidence combined with unexpected result"
//   RESTRICT: Read
//   REPLAN: yes
//
// Grammar produces a MonitorReport-compatible AST.
// ============================================================================

{
  function unquote(s) {
    if (s.startsWith('"') && s.endsWith('"')) {
      return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return s;
  }
}

MonitorReport
  = a:AnomaliesSection EOL
    e:EscalationSection EOL
    r:RestrictSection EOL
    p:ReplanSection EOLopt
    {
      return {
        anomalies: a,
        escalation: e,
        restrictedActions: r,
        forceReplan: p
      };
    }

// ── Anomalies Section ──────────────────────────────────────────

AnomaliesSection
  = "ANOMALIES:" _ "none" { return []; }
  / "ANOMALIES:" EOL list:AnomalyList { return list; }

AnomalyList
  = first:AnomalyLine rest:(EOL a:AnomalyLine { return a; })* { return [first, ...rest]; }

AnomalyLine
  = "@" moduleId:Identifier _ anomalyType:AnomalyType _ detail:QuotedString
    {
      return {
        moduleId: moduleId,
        type: anomalyType,
        detail: unquote(detail)
      };
    }

AnomalyType
  = "low-confidence" { return "low-confidence"; }
  / "unexpected-result" { return "unexpected-result"; }
  / "compound" { return "compound"; }

// ── Escalation Section ─────────────────────────────────────────

EscalationSection
  = "ESCALATE:" _ "none" { return undefined; }
  / "ESCALATE:" _ msg:QuotedString { return unquote(msg); }

// ── Restrict Section ───────────────────────────────────────────

RestrictSection
  = "RESTRICT:" _ "none" { return []; }
  / "RESTRICT:" _ first:Identifier rest:("," _ id:Identifier { return id; })*
    { return [first, ...rest]; }

// ── Replan Section ─────────────────────────────────────────────

ReplanSection
  = "REPLAN:" _ "yes" { return true; }
  / "REPLAN:" _ "no" { return false; }

// ── Primitives ─────────────────────────────────────────────────

Identifier "identifier"
  = chars:$[a-zA-Z0-9_-]+ { return chars; }

QuotedString "quoted string"
  = '"' chars:QuotedChar* '"' { return '"' + chars.join('') + '"'; }

QuotedChar
  = '\\"' { return '\\"'; }
  / '\\\\' { return '\\\\'; }
  / [^"\\\r\n] { return text(); }

// ── Line Structure ─────────────────────────────────────────────

_ "optional spaces"
  = [ \t]*

EOL "end of line"
  = _ "\r\n" / _ "\n"

EOLopt "optional end of line"
  = (_ "\r\n" / _ "\n")?
