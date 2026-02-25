# Clavis Question XML Import Schema (v1)

This schema supports Phase `3.3 XML Import` for v1 question types:
- `mcq_single`
- `mcq_multi`
- `true_false`
- `short_answer`

## Root

```xml
<quiz version="1">
  <question ...>...</question>
  <question ...>...</question>
</quiz>
```

## Question Attributes

- `type` (required): `mcq_single | mcq_multi | true_false | short_answer`
- `subject` (required): subject `code` or subject `name` in Clavis
- `difficulty` (optional): `easy | medium | hard` (default `medium`)
- `source` (optional): free text source
- `active` (optional): `true | false` (default `true`)

## Supported Child Elements

- `<prompt>` (required)
- `<explanation>` (optional)
- `<tags>` optional container with `<tag>` children
- `<options>` required for MCQ types:
  - `<option correct="true|false">Text</option>`
- `<answer>` required for `true_false` and `short_answer`
  - `true_false`: `true` or `false`
  - `short_answer`: canonical expected answer string
- `<shortAnswerRules>` optional JSON object text for `short_answer`

## Examples

### MCQ Single

```xml
<question type="mcq_single" subject="MTH101" difficulty="easy">
  <prompt>2 + 2 = ?</prompt>
  <options>
    <option correct="false">3</option>
    <option correct="true">4</option>
    <option correct="false">5</option>
  </options>
  <tags><tag>arithmetic</tag></tags>
</question>
```

### MCQ Multiple

```xml
<question type="mcq_multi" subject="BIO101" difficulty="medium">
  <prompt>Select mammals</prompt>
  <options>
    <option correct="true">Whale</option>
    <option correct="false">Shark</option>
    <option correct="true">Bat</option>
  </options>
</question>
```

### True/False

```xml
<question type="true_false" subject="PHY101">
  <prompt>Light travels faster than sound.</prompt>
  <answer>true</answer>
</question>
```

### Short Answer

```xml
<question type="short_answer" subject="ENG101">
  <prompt>Who wrote Hamlet?</prompt>
  <answer>William Shakespeare</answer>
  <shortAnswerRules>{"caseSensitive": false}</shortAnswerRules>
</question>
```

## Import Behavior

- Duplicate detection uses Clavis question content hash.
- Imports do not create subjects automatically; `subject` must match an existing subject `code` or `name`.
- Errors are collected per question and returned in an import report.
