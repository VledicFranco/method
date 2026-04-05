Output
  = "ISOLATION: " isolation:$("worktree" / "shared") EOL
    "WORKTREE_PATH: " worktree_path:("none" { return "none"; } / "\"" path:$[^"]* "\"" { return "\"" + path + "\""; }) EOL
    "WORKTREE_BRANCH: " worktree_branch:("none" { return "none"; } / "\"" branch:$[^"]* "\"" { return "\"" + branch + "\""; }) EOL
    "METALS_AVAILABLE: " metals:$("yes" { return true; } / "no" { return false; }) EOLopt
    { return { isolation: isolation, worktree_path: worktree_path, worktree_branch: worktree_branch, metals: metals }; }

_ = [ \t]*
EOL = _ "\n"
EOLopt = (_ "\n")?