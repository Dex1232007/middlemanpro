import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transactionId, action, telegramId } = await req.json();

    if (!transactionId || !action || !telegramId) {
      return new Response(JSON.stringify({ error: "Missing parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get transaction
    const { data: tx } = await supabase
      .from("transactions")
      .select("*")
      .eq("id", transactionId)
      .maybeSingle();

    if (!tx) {
      return new Response(JSON.stringify({ error: "Transaction not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isBuyer = tx.buyer_id === profile.id;
    const isSeller = tx.seller_id === profile.id;

    if (!isBuyer && !isSeller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let newStatus = tx.status;
    let updateData: Record<string, unknown> = {};

    switch (action) {
      case "item_sent":
        if (!isSeller || tx.status !== "payment_received") {
          return new Response(JSON.stringify({ error: "Invalid action" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        newStatus = "item_sent";
        updateData = { status: newStatus, item_sent_at: new Date().toISOString() };
        break;

      case "confirm_received":
        if (!isBuyer || tx.status !== "item_sent") {
          return new Response(JSON.stringify({ error: "Invalid action" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        newStatus = "completed";
        updateData = { status: newStatus, confirmed_at: new Date().toISOString() };
        
        // Credit seller
        await supabase.rpc("increment_balance", {
          profile_id: tx.seller_id,
          amount: tx.seller_receives_ton,
        });
        break;

      case "dispute":
        if (!["payment_received", "item_sent"].includes(tx.status)) {
          return new Response(JSON.stringify({ error: "Cannot dispute" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        newStatus = "disputed";
        updateData = { status: newStatus };
        break;

      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    await supabase.from("transactions").update(updateData).eq("id", transactionId);

    return new Response(JSON.stringify({ success: true, status: newStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
