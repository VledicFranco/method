Output
  = "ANOMALIES:" _ anomalies:AnomalyList _ "ESCALATE:" _ escalate:EscalateValue _ "RESTRICT:" _ restrict:RestrictValue _ "REPLAN:" _ replan:ReplanValue EOLopt

AnomalyList
  = "none" { return []; }
  / " " anomalies:Anomaly+ { return anomalies; }

Anomaly
  = "@" identifier:$[a-zA-Z0-9_-]+ " " type:$[a-zA-Z0-9_-]+ " " message:$[^"]* '"' { return { id: identifier, type: type, message: message }; }

EscalateValue
  = "none" { return null; }
  / '"' message:$[^"]* '"' { return message; }

RestrictValue
  = "none" { return []; }
  / action:$[a-zA-Z0-9_-]+ ("," _ r_action:$[a-zA-Z0-9_-]+ { return r_action; })* { return [action]; }

ReplanValue
  = "yes" { return true; }
  / "no" { return false; }

EOLopt
  = "\n" / "\r\n" / ""

_ = [ \t]*