Rebuild the codesight wiki and regenerate the core repomix context file.

Run these two commands sequentially:

```bash
npx codesight --wiki --benchmark
npx repomix --compress --output repomix-core.xml
```

Report the repomix token count and any codesight warnings when done.
