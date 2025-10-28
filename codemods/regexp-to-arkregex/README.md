# @codemod/regexp-to-arkregex

Migrate `new RegExp()` constructor calls to [arkregex](https://arktype.io/docs/regex)'s type-safe `regex()` function.

## What it does

This codemod automatically transforms your code to use arkregex, a type-safe regex library.

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
