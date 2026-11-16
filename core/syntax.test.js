import { expect, test } from "bun:test";
import { syntaxTokens, highlightedLines, HIGHLIGHT_LANGUAGES } from "./syntax.js";
import { language } from "./documents.js";
const examples = {
 'index.html': '<html><script>const value = "hello";</script></html>',
 'style.css': '.name { color: "red"; width: 10px; }',
 'app.ts': 'export interface Person { name: string; }',
 'app.js': 'const value = function() { return 42; }',
 'Main.java': 'public class Main { private String name = "Java"; }',
 'change.sql': '--liquibase formatted sql\nSELECT name FROM people WHERE id = 1;',
 'task.sh': '#!/bin/bash\nif true; then echo "hello"; fi',
 'changelog.xml': '<databaseChangeLog><!-- change --><changeSet id="1"/></databaseChangeLog>',
 'data.json': '{ "enabled": true, "count": 2 }',
 'deployment.tpl': '{{- if .Values.enabled }}\nname: "service"\n{{- end }}',
 'main.py': 'def run():\n    return "Python" # comment',
 'main.tf': 'resource "aws_s3_bucket" "main" { bucket = "example" }',
};
for (const [path,text] of Object.entries(examples)) test(`source colors cover ${path}`, () => {
 const lang=language(path);expect(HIGHLIGHT_LANGUAGES.has(lang)).toBe(true);
 const tokens=syntaxTokens(text,lang);expect(tokens.map(x=>x.text).join('')).toBe(text);
 expect(tokens.some(x=>x.kind !== 'plain')).toBe(true);
});
test("multiline tokens retain line order and bounded highlights retain full edit source",()=>{
 const text='/* first\nsecond */\nconst a = 1;';
 const out=highlightedLines(text,'javascript');expect(out.lines.length).toBe(3);expect(out.lines[1][0].kind).toBe('comment');
 expect(highlightedLines(text,'javascript',2).limited).toBe(true);
});
