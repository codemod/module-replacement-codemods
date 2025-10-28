# @codemod/arkregex

Migrate `new RegExp()` constructor calls to [arkregex](https://arktype.io/docs/regex)'s type-safe `regex()` function.

## What it does

This codemod automatically transforms your code to use arkregex, a type-safe regex library that provides:

- Type inference for regex patterns
- Compile-time validation
- Better TypeScript integration

### Transformation Example

**Before:**

```typescript
const pattern = new RegExp("\\d+", "g");
const emailRegex = new RegExp("^[a-z]+@[a-z]+\\.[a-z]+$");
```

**After:**

```typescript
import { regex } from "arkregex";
const pattern = regex("\\d+", "g");
const emailRegex = regex("^[a-z]+@[a-z]+\\.[a-z]+$");
```

## Installation

```bash
# Run from registry
codemod run @codemod/arkregex

# Or run locally
codemod run -w workflow.yaml
```

## Development

```bash
# Test the transformation
npm test

# Validate the workflow
codemod validate -w workflow.yaml

# Publish to registry
codemod login
codemod publish
```

## License

MIT
