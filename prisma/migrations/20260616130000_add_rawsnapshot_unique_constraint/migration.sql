-- CreateIndex
CREATE UNIQUE INDEX "RawSnapshot_source_dateRangeStart_dateRangeEnd_key" ON "RawSnapshot"("source", "dateRangeStart", "dateRangeEnd");
