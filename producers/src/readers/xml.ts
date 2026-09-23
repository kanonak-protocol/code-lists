/**
 * Reader for XML sources (IANA registries, ISO 4217 lists), over
 * fast-xml-parser with one fixed configuration so every plugin sees the same
 * shape: attributes under `@name`, element text under `#text` when an element
 * also carries attributes, repeated elements always as arrays where the
 * plugin asks for them via `many()`.
 */
import { XMLParser } from 'fast-xml-parser';

export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  removeNSPrefix: true,
  parseTagValue: false, // keep '001' and '2026-09-17' as strings
  parseAttributeValue: false,
  trimValues: true,
});

export function parseXml(text: string): XmlNode {
  return parser.parse(text) as XmlNode;
}

/** The child elements named `name`, always as an array (absent → empty). */
export function many(node: XmlNode | undefined, name: string): XmlNode[] {
  const value = node?.[name];
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => (typeof v === 'object' && v !== null ? (v as XmlNode) : { '#text': String(v) }));
}

/** The text of a child element (or of the node itself), whether or not it carried attributes. */
export function text(node: XmlNode | undefined, name?: string): string | undefined {
  const value = name === undefined ? node : node?.[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object') {
    const inner = (value as XmlNode)['#text'];
    return inner === undefined ? undefined : String(inner);
  }
  return String(value);
}

/** An attribute of a node (`@name`). */
export function attr(node: XmlNode | undefined, name: string): string | undefined {
  const value = node?.[`@${name}`];
  return value === undefined ? undefined : String(value);
}
