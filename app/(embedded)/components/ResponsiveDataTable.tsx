"use client";

import { Button, Divider, Select, useBreakpoints } from "@shopify/polaris";
import type { SortDirection } from "@shopify/polaris";
import { useState, type ReactNode } from "react";
import styles from "./ResponsiveDataTable.module.css";

type Cell = string | number | ReactNode;

/** Renders labelled rows on compact screens, avoiding horizontal table scrolling. */
export function ResponsiveDataTable({ headings, rows, columnContentTypes, sortable, onSort, compactSortIndex, compactSortDirection }: {
  headings: ReactNode[];
  rows: Cell[][];
  columnContentTypes: ("text" | "numeric")[];
  sortable?: boolean[];
  onSort?: (headingIndex: number, direction: SortDirection) => void;
  compactSortIndex?: number;
  compactSortDirection?: SortDirection;
}) {
  const { xlUp } = useBreakpoints({ defaults: { xlUp: true } });
  const [localSortIndex, setLocalSortIndex] = useState(-1);
  const [localSortDirection, setLocalSortDirection] = useState<SortDirection>("ascending");
  const sortIndex = compactSortIndex ?? localSortIndex;
  const sortDirection = compactSortDirection ?? localSortDirection;
  const applySort = (index: number, direction: SortDirection) => {
    setLocalSortIndex(direction === "none" ? -1 : index);
    setLocalSortDirection(direction === "none" ? "ascending" : direction);
    onSort?.(index, direction);
  };
  const cycleSort = (index: number) => {
    const direction: SortDirection = sortIndex !== index
      ? "ascending"
      : sortDirection === "ascending"
        ? "descending"
        : "none";
    applySort(index, direction);
  };

  if (xlUp) {
    return (
      <table className={styles.table}>
        <thead>
          <tr>
            {headings.map((heading, index) => (
              <th className={`${styles.heading} ${columnContentTypes[index] === "numeric" ? styles.numeric : ""}`} key={index} scope="col" aria-sort={onSort && sortable?.[index] && sortIndex === index ? sortDirection : undefined}>
                {onSort && sortable?.[index] ? (
                  <button className={styles.sortButton} type="button" onClick={() => cycleSort(index)}>
                    {heading}{sortIndex === index && sortDirection !== "none" ? ` (${sortDirection})` : ""}
                  </button>
                ) : heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td className={`${styles.cell} ${columnContentTypes[index] === "numeric" ? styles.numeric : ""}`} key={index}>
                  <div className={styles.value}>{cell}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <div className={styles.stackedTable}>
      {onSort && sortable?.some(Boolean) && (
        <div className={styles.sortControls}>
          <div className={styles.sortSelect}>
            <Select label="Sort rows" value={String(sortIndex)} options={[{ label: "Current order", value: "-1" }, ...headings.map((heading, index) => ({ label: String(heading), value: String(index), disabled: !sortable[index] }))]} onChange={(value) => { const index = Number(value); if (index < 0) applySort(sortable.findIndex(Boolean), "none"); else applySort(index, sortDirection); }} />
          </div>
          <Button size="slim" disabled={sortIndex < 0} onClick={() => applySort(sortIndex, sortDirection === "ascending" ? "descending" : "ascending")}>{sortDirection === "ascending" ? "Ascending" : "Descending"}</Button>
        </div>
      )}
      {rows.map((row, rowIndex) => (
        <div className={styles.stackedRow} key={rowIndex}>
          {row.map((cell, index) => (
            <div className={styles.stackedCell} key={index}>
              <div className={styles.label}>{headings[index]}</div>
              <div className={`${styles.value} ${columnContentTypes[index] === "numeric" ? styles.numeric : ""}`}>{cell}</div>
            </div>
          ))}
          {rowIndex < rows.length - 1 && <Divider />}
        </div>
      ))}
    </div>
  );
}
