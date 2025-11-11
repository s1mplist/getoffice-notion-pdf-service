import { NextRequest, NextResponse } from "next/server";
import { makePDFFromDomain } from "@/app/pdf";

// Adicionar headers CORS
const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // ou especifique domínios permitidos
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { url } = body;

        if (!url || typeof url !== 'string') {
            return NextResponse.json(
                { error: 'URL é obrigatória' },
                { status: 400, headers: corsHeaders }
            );
        }

        try {
            new URL(url);
        } catch {
            return NextResponse.json(
                { error: 'URL inválida' },
                { status: 400, headers: corsHeaders }
            );
        }

        console.log(`[API] Generating PDF for URL: ${url}`);

        const pdfBuffer = await makePDFFromDomain(url);

        // Converter Buffer para Uint8Array (compatível com NextResponse)
        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="document.pdf"`,
            },
        });
    } catch (error) {
        console.error("[API] Error generating PDF:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Erro ao gerar PDF" },
            { status: 500, headers: corsHeaders }
        );
    }
}