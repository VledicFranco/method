WorktreeInfo
  = isolation:IsolationSection EOL worktree_path:WorktreePathSection EOL worktree_branch:WorktreeBranchSection EOL metals_available:MetalsAvailableSection EOLopt
    { return { isolation: isolation, worktree_path: worktree_path, worktree_branch: worktree_branch, metals_available: metals_available }; }

IsolationSection
  = "ISOLATION:" _ v:("shared" / "worktree") { return v; }

WorktreePathSection
  = "WORKTREE_PATH:" _ "none" { return null; }
  / "WORKTREE_PATH:" _ v:QuotedString { return v; }

WorktreeBranchSection
  = "WORKTREE_BRANCH:" _ "none" { return null; }
  / "WORKTREE_BRANCH:" _ v:QuotedString { return v; }

MetalsAvailableSection
  = "METALS_AVAILABLE:" _ v:Bool { return v; }

Bool = "yes" { return true; } / "no" { return false; }
QuotedString = '"' chars:$[^"]* '"' { return chars; }
_ = [ \t]*
EOL = _ "\n"
EOLopt = (_ "\n")?