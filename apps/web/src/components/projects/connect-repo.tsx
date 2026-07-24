"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ConnectRepoProps = {
  onConnect?: (url: string) => void;
};

export function ConnectRepo({ onConnect }: Readonly<ConnectRepoProps>) {
  const [url, setUrl] = useState("");

  const submit = () => {
    const trimmed = url.trim();
    if (trimmed) onConnect?.(trimmed);
    setUrl("");
  };

  return (
    <Tabs defaultValue="public" className="w-full">
      <TabsList>
        <TabsTrigger value="public">Public URL</TabsTrigger>
        <TabsTrigger value="private">Private (GitHub)</TabsTrigger>
      </TabsList>

      <TabsContent value="public">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Repository URL"
          />
          <Button type="submit">
            <Plus className="size-4" /> Connect
          </Button>
        </form>
      </TabsContent>

      <TabsContent value="private">
        <p className="text-muted-foreground text-sm">
          Connect the GitHub App to import your private repositories. (Coming in v1.1.)
        </p>
      </TabsContent>
    </Tabs>
  );
}
