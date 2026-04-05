// DSL Inducer output — auto-induced from 20 Monitor traces by qwen3-coder:30b
// Only fix applied: renamed duplicate "action" label to "rest" on line 16

Output
  = "ANOMALIES:" _ anomalies:AnomalyList EOL "ESCALATE:" _ escalate:EscalateValue EOL "RESTRICT:" _ restrict:RestrictValue EOL "REPLAN:" _ replan:ReplanValue EOLopt
    { return { anomalies: anomalies, escalation: escalate, restrictedActions: restrict, forceReplan: replan }; }

AnomalyList
  = "none" { return []; }
  / EOL first:Anomaly rest:(EOL a:Anomaly { return a; })* { return [first, ...rest]; }

Anomaly
  = "@" identifier:$[a-zA-Z0-9_-]+ " " atype:AnomalyType " \"" message:$[^"]* "\""
    { return { moduleId: identifier, type: atype, detail: message }; }

AnomalyType
  = "low-confidence" { return "low-confidence"; }
  / "unexpected-result" { return "unexpected-result"; }
  / "compound" { return "compound"; }

EscalateValue
  = "none" { return undefined; }
  / "\"" message:$[^"]* "\"" { return message; }

RestrictValue
  = "none" { return []; }
  / first:$[a-zA-Z0-9_-]+ rest:("," _ r:$[a-zA-Z0-9_-]+ { return r; })* { return [first, ...rest]; }

ReplanValue
  = "yes" { return true; }
  / "no" { return false; }

EOL = _ "\n"
EOLopt = (_ "\n")?
_ = [ \t]*
